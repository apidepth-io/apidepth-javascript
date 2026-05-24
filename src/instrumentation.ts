// HTTP client instrumentation for the Apidepth SDK.
//
// Patching strategy
// -----------------
// 1. node:http + node:https request() — covers axios, node-fetch v2, got,
//    and anything backed by Node's built-in HTTP stack.
// 2. globalThis.fetch — covers native fetch (Node 18+), undici, node-fetch v3.
//
// Cold-start detection (matching the Ruby gem)
// --------------------------------------------
// Node's http.Agent exposes socket reuse state. When the 'socket' event fires
// on a ClientRequest, socket.connecting === true means a new TCP connection
// is being established (cold start). socket.connecting === false means the
// socket was reused from the keep-alive pool (warm). This is equivalent to
// Ruby's Net::HTTP#started? — the Python SDK cannot do this (requests/httpx
// don't expose a public API for it).
//
// Recursion guard
// ---------------
// The collector's own HTTPS flush is wrapped in withSkip(), which sets an
// AsyncLocalStorage context. isSkipped() returns true for the duration of
// that async context, preventing self-instrumentation architecturally.

import http, { type IncomingMessage, type ClientRequest } from "node:http";
import https from "node:https";
import { getConfiguration } from "./configuration.js";
import { VendorRegistry } from "./vendor_registry.js";
import { extractRateLimitHeaders } from "./rate_limit_headers.js";
import { Collector } from "./collector.js";
import { buildEvent, type Outcome } from "./event.js";
import { isSkipped } from "./skip.js";

let _httpPatched = false;
let _httpsPatched = false;
let _fetchPatched = false;

export function instrument(): void {
  _patchNodeHttp();
  _patchNodeHttps();
  _patchFetch();
}

export function resetInstrumentation(): void {
  _httpPatched = false;
  _httpsPatched = false;
  _fetchPatched = false;
}

// ---------------------------------------------------------------------------
// node:http + node:https
// ---------------------------------------------------------------------------

type RequestFn = typeof http.request;

function _makeWrapper(originalFn: RequestFn): RequestFn {
  return function wrappedRequest(
    this: unknown,
    urlOrOptions: Parameters<RequestFn>[0],
    optionsOrCallback?: Parameters<RequestFn>[1],
    callback?: Parameters<RequestFn>[2]
  ): ClientRequest {
    const req: ClientRequest = (originalFn as (...args: unknown[]) => ClientRequest).apply(this, [
      urlOrOptions,
      optionsOrCallback,
      callback,
    ]);

    const config = getConfiguration();
    if (isSkipped() || !config.enabled) return req;

    const info = _extractRequestInfo(urlOrOptions, optionsOrCallback);
    if (!info) return req;
    const { host, path, method } = info;

    if (config.ignoredHosts.includes(host)) return req;
    if (!_sampled(config.sampleRate)) return req;

    const start = performance.now();
    let coldStart = true; // assume cold until socket fires

    req.on("socket", (socket) => {
      // socket.connecting is true for a new connection, false for a reused one
      coldStart = socket.connecting;
    });

    req.on("response", (res: IncomingMessage) => {
      const durationMs = Math.round(performance.now() - start);
      _recordSuccess({
        host,
        path,
        method,
        status: res.statusCode ?? 0,
        headers: res.headers as Record<string, string | string[]>,
        durationMs,
        coldStart,
      });
    });

    req.on("error", (err: Error) => {
      const durationMs = Math.round(performance.now() - start);
      _recordTimeoutIfApplicable({ err, host, path, method, durationMs, coldStart });
    });

    return req;
  } as RequestFn;
}

function _patchNodeHttp(): void {
  if (_httpPatched) return;
  const original = http.request.bind(http);
  (http as { request: RequestFn }).request = _makeWrapper(original);
  _httpPatched = true;
}

function _patchNodeHttps(): void {
  if (_httpsPatched) return;
  const original = https.request.bind(https);
  (https as { request: RequestFn }).request = _makeWrapper(original as RequestFn);
  _httpsPatched = true;
}

// ---------------------------------------------------------------------------
// globalThis.fetch (Node 18+)
// ---------------------------------------------------------------------------

function _patchFetch(): void {
  if (_fetchPatched) return;
  if (typeof globalThis.fetch !== "function") return;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function patchedFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> {
    const config = getConfiguration();
    if (isSkipped() || !config.enabled) return originalFetch(input, init);

    let host = "";
    let path = "/";
    try {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL((input as Request).url);
      host = url.hostname;
      path = url.pathname + url.search;
    } catch {
      return originalFetch(input, init);
    }

    const method = (
      (init?.method ?? (input instanceof Request ? input.method : "GET")) as string
    ).toUpperCase();

    if (config.ignoredHosts.includes(host)) return originalFetch(input, init);
    if (!_sampled(config.sampleRate)) return originalFetch(input, init);

    const start = performance.now();
    try {
      const response = await originalFetch(input, init);
      const durationMs = Math.round(performance.now() - start);
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      // fetch does not expose socket-level connection reuse
      _recordSuccess({
        host,
        path,
        method,
        status: response.status,
        headers,
        durationMs,
        coldStart: false,
      });
      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      _recordTimeoutIfApplicable({
        err: err as Error,
        host,
        path,
        method,
        durationMs,
        coldStart: false,
      });
      throw err;
    }
  };

  _fetchPatched = true;
}

// ---------------------------------------------------------------------------
// Shared recording helpers
// ---------------------------------------------------------------------------

interface SuccessArgs {
  host: string;
  path: string;
  method: string;
  status: number;
  headers: Record<string, string | string[]>;
  durationMs: number;
  coldStart: boolean;
}

function _recordSuccess({
  host,
  path,
  method,
  status,
  headers,
  durationMs,
  coldStart,
}: SuccessArgs): void {
  try {
    const result = VendorRegistry.identify(host, path);
    if (!result) return;
    const [vendor, endpoint] = result;

    const outcome = _outcomeFromStatus(status);
    const nowMs = Date.now();
    const rl = extractRateLimitHeaders(headers as Record<string, string>, nowMs);

    Collector.getInstance().record(
      buildEvent({
        vendor,
        endpoint,
        method,
        status,
        outcome,
        duration_ms: durationMs,
        cold_start: coldStart,
        env: _resolveEnv(),
        ts: nowMs,
        ...(rl ?? {}),
      })
    );
  } catch {
    // instrumentation must never crash the caller
  }
}

interface TimeoutArgs {
  err: Error;
  host: string;
  path: string;
  method: string;
  durationMs: number;
  coldStart: boolean;
}

function _recordTimeoutIfApplicable({
  err,
  host,
  path,
  method,
  durationMs,
  coldStart,
}: TimeoutArgs): void {
  try {
    const name = err.constructor?.name ?? err.name ?? "";
    const isTimeout = /timeout/i.test(name) || err.message?.toLowerCase().includes("timeout");
    if (!isTimeout) return;

    const result = VendorRegistry.identify(host, path);
    if (!result) return;
    const [vendor, endpoint] = result;

    Collector.getInstance().record(
      buildEvent({
        vendor,
        endpoint,
        method,
        status: null,
        outcome: "timeout",
        error_class: name,
        duration_ms: durationMs,
        cold_start: coldStart,
        env: _resolveEnv(),
        ts: Date.now(),
      })
    );
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _extractRequestInfo(
  urlOrOptions: Parameters<RequestFn>[0],
  optionsOrCallback?: Parameters<RequestFn>[1]
): { host: string; path: string; method: string } | null {
  try {
    if (typeof urlOrOptions === "string") {
      const u = new URL(urlOrOptions);
      const method =
        typeof optionsOrCallback === "object" &&
        optionsOrCallback !== null &&
        "method" in optionsOrCallback
          ? String((optionsOrCallback as { method?: string }).method ?? "GET")
          : "GET";
      return { host: u.hostname, path: u.pathname + u.search, method: method.toUpperCase() };
    }
    if (urlOrOptions instanceof URL) {
      const method =
        typeof optionsOrCallback === "object" &&
        optionsOrCallback !== null &&
        "method" in optionsOrCallback
          ? String((optionsOrCallback as { method?: string }).method ?? "GET")
          : "GET";
      return {
        host: urlOrOptions.hostname,
        path: urlOrOptions.pathname + urlOrOptions.search,
        method: method.toUpperCase(),
      };
    }
    if (typeof urlOrOptions === "object" && urlOrOptions !== null) {
      const opts = urlOrOptions as http.RequestOptions;
      return {
        host: String(opts.hostname ?? opts.host ?? "").replace(/:\d+$/, ""),
        path: String(opts.path ?? "/"),
        method: String(opts.method ?? "GET").toUpperCase(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function _outcomeFromStatus(status: number): Outcome {
  if (status >= 200 && status <= 299) return "success";
  if (status >= 300 && status <= 399) return "redirect";
  if (status >= 400 && status <= 499) return "client_error";
  if (status >= 500 && status <= 599) return "server_error";
  return "unknown";
}

function _sampled(rate: number): boolean {
  return rate >= 1.0 || Math.random() < rate;
}

function _resolveEnv(): string {
  return getConfiguration().environment ?? "unknown";
}
