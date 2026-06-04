import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Collector } from "../src/collector.js";
import { VendorRegistry, BUNDLED_BASELINE } from "../src/vendor_registry.js";
import { resetConfiguration, getConfiguration } from "../src/configuration.js";
import { instrument, resetInstrumentation } from "../src/instrumentation.js";
import https from "node:https";
import http from "node:http";
import { EventEmitter } from "node:events";

beforeEach(() => {
  Collector.reset();
  resetConfiguration();
  resetInstrumentation();
  VendorRegistry.replace(BUNDLED_BASELINE);
});

// Build a minimal fake ClientRequest/IncomingMessage pair
function makeFakeRequest(opts: {
  statusCode?: number;
  headers?: Record<string, string>;
  socketConnecting?: boolean;
  errorAfterMs?: number;
  responseBody?: string;
  responseEmitError?: boolean;
}) {
  const req = new EventEmitter() as ReturnType<typeof https.request>;
  (req as unknown as { end: () => void }).end = () => {};

  // Simulate response event after tick
  process.nextTick(() => {
    if (opts.errorAfterMs !== undefined) {
      const err = new Error("socket timeout") as Error & { name: string };
      err.name = "TimeoutError";
      req.emit("error", err);
      return;
    }
    const socket = new EventEmitter() as NodeJS.Socket;
    (socket as unknown as { connecting: boolean }).connecting = opts.socketConnecting ?? false;
    req.emit("socket", socket);

    const res = new EventEmitter() as import("node:http").IncomingMessage;
    (res as unknown as { statusCode: number }).statusCode = opts.statusCode ?? 200;
    (res as unknown as { headers: Record<string, string> }).headers = opts.headers ?? {};
    req.emit("response", res);

    // Emit body events after the response handlers have been registered
    if (opts.responseBody !== undefined) {
      process.nextTick(() => {
        res.emit("data", Buffer.from(opts.responseBody!));
        res.emit("end");
      });
    } else if (opts.responseEmitError) {
      process.nextTick(() => {
        res.emit("error", new Error("response stream error"));
      });
    }
  });

  return req;
}

describe("instrumentation cold start tagging", () => {
  it("records cold_start=true when socket.connecting is true", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    // Patch https.request to return a fake request with connecting=true
    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200, socketConnecting: true })
    ) as unknown as typeof https.request;

    instrument();

    // Make a fake request to api.stripe.com
    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));

    const stats = Collector.getInstance().stats();
    expect(stats.queueSize).toBe(1);

    // Restore
    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("records cold_start=false when socket is reused", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200, socketConnecting: false })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));

    const stats = Collector.getInstance().stats();
    expect(stats.queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

describe("instrumentation ignored_hosts", () => {
  it("does not record events for ignored hosts", async () => {
    getConfiguration().ignoredHosts = ["api.stripe.com"];
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("does not record events for glob-matched ignored hosts", async () => {
    getConfiguration().ignoredHosts = ["*.internal"];
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: "api.internal", path: "/health", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// globalThis.fetch patching
// ---------------------------------------------------------------------------

describe("instrumentation fetch patching", () => {
  let savedFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (savedFetch !== undefined) {
      globalThis.fetch = savedFetch;
    } else {
      delete (globalThis as unknown as Record<string, unknown>)["fetch"];
    }
  });

  it("records an event when fetch succeeds for a known vendor", async () => {
    getConfiguration().apiKey = "test-key";
    const mockResponse = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch("https://api.stripe.com/v1/charges");

    expect(Collector.getInstance().stats().queueSize).toBe(1);
  });

  it("does not record an event for an unrecognised host", async () => {
    getConfiguration().apiKey = "test-key";
    const mockResponse = new Response("{}", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch("https://api.unknownvendor.test/v1/foo");

    expect(Collector.getInstance().stats().queueSize).toBe(0);
  });

  it("passes through and does not record when the fetch URL cannot be parsed", async () => {
    getConfiguration().apiKey = "test-key";
    const mockResponse = new Response("{}", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    // "not-a-url" causes URL parsing to throw in the patched fetch;
    // the catch block calls originalFetch directly without recording an event
    await globalThis.fetch("not-a-url" as Parameters<typeof globalThis.fetch>[0]);

    expect(Collector.getInstance().stats().queueSize).toBe(0);
  });
});

describe("instrumentation disabled", () => {
  it("does not record events when enabled=false", async () => {
    getConfiguration().enabled = false;
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// node:http (plain HTTP) patching
// ---------------------------------------------------------------------------

describe("instrumentation http patching", () => {
  it("records an event from http.request to a known vendor", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = http.request;

    (http as { request: typeof http.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof http.request;

    instrument();

    const req = http.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (http as { request: typeof http.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// Timeout error path
// ---------------------------------------------------------------------------

describe("instrumentation timeout errors", () => {
  it("records a timeout outcome when the request emits a TimeoutError", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ errorAfterMs: 0 })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// Sample rate
// ---------------------------------------------------------------------------

describe("instrumentation URL-instance overload preserves method", () => {
  it("records the correct method when https.request is called with a URL object", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200, socketConnecting: false })
    ) as unknown as typeof https.request;

    instrument();

    const url = new URL("https://api.stripe.com/v1/charges");
    const req = https.request(url, { method: "POST" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));

    // One event recorded — method should not be silently coerced to GET
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// Outcome mapping (_outcomeFromStatus branches)
// ---------------------------------------------------------------------------

describe("instrumentation outcome mapping", () => {
  const makeTestCase = (statusCode: number, expectedOutcome: string) =>
    it(`records outcome "${expectedOutcome}" for status ${statusCode}`, async () => {
      getConfiguration().apiKey = "test-key";
      const originalRequest = https.request;

      (https as { request: typeof https.request }).request = vi.fn(() =>
        makeFakeRequest({ statusCode })
      ) as unknown as typeof https.request;

      instrument();
      const recordSpy = vi.spyOn(Collector.getInstance(), "record");
      const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
      req.end();

      await new Promise((r) => setTimeout(r, 50));

      expect(Collector.getInstance().stats().queueSize).toBe(1);
      expect(recordSpy.mock.calls[0][0].outcome).toBe(expectedOutcome);

      recordSpy.mockRestore();
      (https as { request: typeof https.request }).request = originalRequest;
    });

  makeTestCase(301, "unknown");
  makeTestCase(404, "client_error");
  makeTestCase(500, "server_error");
  makeTestCase(600, "unknown");
});

// ---------------------------------------------------------------------------
// _extractRequestInfo: URL string overload and catch branch
// ---------------------------------------------------------------------------

describe("instrumentation request info extraction", () => {
  it("instruments a string URL overload (no explicit method) correctly", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();
    // No options object — hits the ternary false branch (defaults to GET)
    const req = https.request("https://api.stripe.com/v1/charges");
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("instruments a string URL overload with explicit method correctly", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();
    // Options object with method — hits the ternary true branch
    const req = https.request("https://api.stripe.com/v1/charges", { method: "POST" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("instruments a URL instance overload without explicit method", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();
    // URL instance + no options — hits the ternary false branch in the URL branch
    const req = https.request(new URL("https://api.stripe.com/v1/charges"));
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("defaults method to GET when object options omit the method field", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();
    // No `method` key in options → hits `opts.method ?? "GET"` fallback
    const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges" });
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("skips instrumentation gracefully when URL string is invalid", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = http.request;

    (http as { request: typeof http.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof http.request;

    instrument();
    // "not-a-url" causes new URL() to throw; _extractRequestInfo catches and returns null
    // No event should be recorded, but the underlying request still fires.
    const req = http.request("not-a-url" as unknown as Parameters<typeof http.request>[0]);
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (http as { request: typeof http.request }).request = originalRequest;
  });

  it("does not record when urlOrOptions is null (no string/URL/object branch matches)", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = http.request;

    (http as { request: typeof http.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof http.request;

    instrument();
    const req = http.request(null as unknown as Parameters<typeof http.request>[0]);
    req.end();

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (http as { request: typeof http.request }).request = originalRequest;
  });
});

describe("instrumentation sample rate", () => {
  it("drops all events when sampleRate is 0", async () => {
    getConfiguration().apiKey = "test-key";
    getConfiguration().sampleRate = 0;
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();

    for (let i = 0; i < 5; i++) {
      const req = https.request({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });
      req.end();
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// Model name extraction — HTTP path (captureModel = true)
// ---------------------------------------------------------------------------

describe("instrumentation model name extraction via HTTP", () => {
  it("records model_name from JSON response body for an AI vendor host", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        responseBody: '{"model":"gpt-4-turbo","choices":[]}',
      })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
    });
    req.end();

    await new Promise((r) => setTimeout(r, 100));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("records event and recovers when response stream emits an error while capturing model", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        responseEmitError: true,
      })
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
    });
    req.end();

    await new Promise((r) => setTimeout(r, 100));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("handles a string data chunk in the response body buffer", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    // Emit a string chunk (not a Buffer) to cover the typeof chunk === "string" branch
    (https as { request: typeof https.request }).request = vi.fn(() => {
      const req = new EventEmitter() as ReturnType<typeof https.request>;
      (req as unknown as { end: () => void }).end = () => {};
      process.nextTick(() => {
        const socket = new EventEmitter() as NodeJS.Socket;
        (socket as unknown as { connecting: boolean }).connecting = false;
        req.emit("socket", socket);

        const res = new EventEmitter() as import("node:http").IncomingMessage;
        (res as unknown as { statusCode: number }).statusCode = 200;
        (res as unknown as { headers: Record<string, string> }).headers = {
          "content-type": "application/json",
        };
        req.emit("response", res);

        process.nextTick(() => {
          res.emit("data", '{"model":"claude-3-opus"}');
          res.emit("end");
        });
      });
      return req;
    }) as unknown as typeof https.request;

    instrument();

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
    });
    req.end();

    await new Promise((r) => setTimeout(r, 100));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });

  it("caps buffer and still records event when response body exceeds 8 KB", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;

    const largeChunk = "x".repeat(9_000);

    (https as { request: typeof https.request }).request = vi.fn(() => {
      const req = new EventEmitter() as ReturnType<typeof https.request>;
      (req as unknown as { end: () => void }).end = () => {};
      process.nextTick(() => {
        const socket = new EventEmitter() as NodeJS.Socket;
        (socket as unknown as { connecting: boolean }).connecting = false;
        req.emit("socket", socket);

        const res = new EventEmitter() as import("node:http").IncomingMessage;
        (res as unknown as { statusCode: number }).statusCode = 200;
        (res as unknown as { headers: Record<string, string> }).headers = {
          "content-type": "application/json",
        };
        req.emit("response", res);

        process.nextTick(() => {
          // First chunk pushes buffer past 8 KB, setting capped = true
          res.emit("data", Buffer.from(largeChunk));
          // Second chunk should be ignored (capped)
          res.emit("data", Buffer.from('{"model":"late-model"}'));
          res.emit("end");
        });
      });
      return req;
    }) as unknown as typeof https.request;

    instrument();

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
    });
    req.end();

    await new Promise((r) => setTimeout(r, 100));
    // Event is still recorded even if body parsing found no model
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// Model name extraction — fetch path (captureModel = true)
// ---------------------------------------------------------------------------

describe("instrumentation model name extraction via fetch", () => {
  let savedFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (savedFetch !== undefined) {
      globalThis.fetch = savedFetch;
    } else {
      delete (globalThis as unknown as Record<string, unknown>)["fetch"];
    }
  });

  it("records model_name when AI vendor fetch returns JSON with model field", async () => {
    getConfiguration().apiKey = "test-key";
    const mockResponse = new Response('{"model":"gpt-4o","choices":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch("https://api.openai.com/v1/chat/completions", { method: "POST" });

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);
  });

  it("records event when response.clone().text() rejects", async () => {
    getConfiguration().apiKey = "test-key";
    const mockResponse = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(mockResponse, "clone").mockReturnValue({
      text: () => Promise.reject(new Error("body read error")),
    } as unknown as Response);
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch("https://api.openai.com/v1/chat/completions", { method: "POST" });

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);
  });

  it("rethrows and does not record when fetch itself throws a non-timeout error", async () => {
    getConfiguration().apiKey = "test-key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    instrument();
    await expect(globalThis.fetch("https://api.openai.com/v1/chat/completions")).rejects.toThrow(
      "network failure"
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);
  });

  it("records a timeout event and rethrows when fetch throws a TimeoutError", async () => {
    getConfiguration().apiKey = "test-key";
    const err = new Error("fetch timeout") as Error & { name: string };
    err.name = "TimeoutError";
    globalThis.fetch = vi.fn().mockRejectedValue(err);

    instrument();
    await expect(globalThis.fetch("https://api.openai.com/v1/chat/completions")).rejects.toThrow(
      "fetch timeout"
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);
  });
});

describe("instrumentation covers http.get / https.get (JS-009)", () => {
  it("records an event for a direct https.get call", async () => {
    getConfiguration().apiKey = "test-key";
    const originalRequest = https.request;
    const originalGet = https.get;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 })
    ) as unknown as typeof https.request;

    instrument();

    // https.get is now the SDK wrapper; it must route through the patched
    // https.request (the get wrapper also calls req.end() for us).
    https.get({ hostname: "api.stripe.com", path: "/v1/charges", method: "GET" });

    await new Promise((r) => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
    (https as { get: typeof https.get }).get = originalGet;
  });
});
