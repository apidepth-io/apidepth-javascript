// Background event queue and HTTPS transport.
//
// Architecture mirrors the Ruby gem and Python SDK:
//   - Bounded queue (5 000 events max)
//   - setInterval flush loop (daemon-style via .unref())
//   - process.on('beforeExit') + SIGTERM for graceful shutdown flush
//   - Persistent HTTPS Agent (keep-alive) for batched POSTs
//   - AsyncLocalStorage recursion guard (withSkip) prevents self-instrumentation
//
// Cold-start detection: unlike Python (requests/httpx), Node's http.Agent
// exposes socket reuse. The instrumentation layer tags events with cold_start
// based on socket.connecting at request time — matching the Ruby gem's
// Net::HTTP#started? approach.

import https from 'node:https';
import { URL } from 'node:url';
import { getConfiguration } from './configuration.js';
import { getLogger, sanitizeLog } from './logger.js';
import { withSkip } from './skip.js';
import type { ApidepthEvent } from './event.js';
import { VERSION } from './version.js';
import * as os from 'node:os';

export const MAX_BATCH_SIZE    = 100;
export const MAX_QUEUE_SIZE    = 5_000;
export const FAILURE_THRESHOLD = 3;
export const DEFAULT_URL       = 'https://collector.apidepth.io/v1/events';

// Matches hostnames that must never be used as a collector endpoint.
// Canonical test cases live in apidepth-collector/tests/fixtures/private_host_cases.json.
// All SDK implementations load that fixture and must pass every case.
const PRIVATE_HOST_RE = /
  ^localhost$          |
  ^127\.               |
  ^0\.0\.0\.0$         |
  ^0$                  |
  ^169\.254\.          |
  ^10\.                |
  ^172\.(1[6-9]|2\d|3[01])\.  |
  ^192\.168\.          |
  ^\[?::1\]?$          |
  ^\[?f[cd]            |
  ^\[?fe80:
/xi;

export interface CollectorStats {
  queueSize: number;
  consecutiveFailures: number;
  totalDropped: number;
  lastFlushAt: number | null;
}

export class Collector {
  private static _instance: Collector | null = null;

  static getInstance(): Collector {
    if (!this._instance) this._instance = new Collector();
    return this._instance;
  }

  static reset(): void {
    if (this._instance) {
      this._instance._teardown();
      this._instance = null;
    }
  }

  private _queue: ApidepthEvent[]       = [];
  private _consecutiveFailures          = 0;
  private _totalDropped                 = 0;
  private _lastFlushAt: number | null   = null;
  private _agent: https.Agent | null    = null;
  private _cachedUrl: URL | null        = null;
  private _warnedNoKey                  = false;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _beforeExitHandler: (() => void) | null            = null;
  private _sigtermHandler: (() => void) | null               = null;

  constructor() {
    this._startFlushTimer();
    this._registerExitHandlers();
  }

  record(event: ApidepthEvent): void {
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      this._totalDropped++;
      return;
    }
    this._queue.push(event);
  }

  async flush(): Promise<void> {
    const events = this._drainQueue();
    if (events.length === 0) return;
    try {
      await this._sendBatch(events);
      this._consecutiveFailures = 0;
      this._lastFlushAt = Date.now();
    } catch (err) {
      this._consecutiveFailures++;
      this._invokeErrorCallback(err as Error, events.length);
      getLogger().warn(`[Apidepth] Final flush failed: ${sanitizeLog(err)}`);
    }
  }

  stats(): CollectorStats {
    return {
      queueSize:            this._queue.length,
      consecutiveFailures:  this._consecutiveFailures,
      totalDropped:         this._totalDropped,
      lastFlushAt:          this._lastFlushAt,
    };
  }

  private _startFlushTimer(): void {
    const intervalMs = Math.max(1, getConfiguration().flushInterval) * 1000;
    this._flushTimer = setInterval(() => { void this._safeFlush(); }, intervalMs);
    // .unref() makes this a "daemon" timer — it won't prevent Node from exiting
    // when the event loop would otherwise be empty (mirrors daemon=True in Python).
    this._flushTimer.unref();
  }

  private _registerExitHandlers(): void {
    this._beforeExitHandler = () => { void this._safeFlush(); };
    this._sigtermHandler    = () => {
      this.flush().finally(() => process.exit(0));
    };
    process.on('beforeExit', this._beforeExitHandler);
    process.on('SIGTERM',    this._sigtermHandler);
  }

  private _teardown(): void {
    if (this._flushTimer)        clearInterval(this._flushTimer);
    if (this._beforeExitHandler) process.off('beforeExit', this._beforeExitHandler);
    if (this._sigtermHandler)    process.off('SIGTERM',    this._sigtermHandler);
    this._agent?.destroy();
    this._agent = null;
  }

  private async _safeFlush(): Promise<void> {
    const events = this._drainQueue();
    if (events.length === 0) return;
    try {
      await this._sendBatch(events);
      this._consecutiveFailures = 0;
      this._lastFlushAt = Date.now();
    } catch (err) {
      this._consecutiveFailures++;
      this._invokeErrorCallback(err as Error, events.length);
      if (this._consecutiveFailures >= FAILURE_THRESHOLD) {
        getLogger().warn(
          `[Apidepth] Flush has failed ${this._consecutiveFailures} times consecutively. ` +
          `Events are being dropped. Check your API key and network connectivity. ` +
          `Last error: ${sanitizeLog(err)}`,
        );
      }
    }
  }

  private _drainQueue(): ApidepthEvent[] {
    const batch = this._queue.splice(0, MAX_BATCH_SIZE);
    return batch;
  }

  private _invokeErrorCallback(err: Error, dropped: number): void {
    try {
      const cb = getConfiguration().onFlushError;
      if (cb) {
        cb(err, {
          droppedEvents:        dropped,
          consecutiveFailures:  this._consecutiveFailures,
          totalDropped:         this._totalDropped,
        });
      }
    } catch {
      // swallow — callback must never crash the flush path
    }
  }

  private _getAgent(): https.Agent {
    if (!this._agent) {
      this._agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 1 });
    }
    return this._agent;
  }

  private _collectorUrl(): URL {
    if (!this._cachedUrl) {
      const raw = getConfiguration().collectorUrl ?? DEFAULT_URL;
      const parsed = new URL(raw);
      validateCollectorUrl(parsed);
      this._cachedUrl = parsed;
    }
    return this._cachedUrl;
  }

  private _sendBatch(events: ApidepthEvent[]): Promise<void> {
    const config = getConfiguration();
    const key    = config.apiKey ?? '';

    if (!key) {
      if (!this._warnedNoKey) {
        this._warnedNoKey = true;
        getLogger().warn(
          '[Apidepth] No API key configured — events are being dropped. ' +
          'Visit www.apidepth.io to create an account and get your key.',
        );
      }
      return Promise.resolve();
    }

    validateApiKey(key);

    const extra   = config.extraVendors;
    const payload: Record<string, unknown> = {
      batch: events,
      sdk:   sdkMetadata(),
    };
    if (extra && Object.keys(extra).length > 0) payload['extra_vendors'] = extra;

    const body       = Buffer.from(JSON.stringify(payload));
    const url        = this._collectorUrl();
    const agent      = this._getAgent();

    return new Promise<void>((resolve, reject) => {
      withSkip(() => {
        const req = https.request({
          hostname: url.hostname,
          port:     url.port ? parseInt(url.port, 10) : 443,
          path:     url.pathname || '/',
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Authorization':  `Bearer ${key}`,
            'Content-Length': body.byteLength,
          },
          agent,
          timeout: 5000,
        }, (res) => {
          res.resume(); // drain so keep-alive connection can be reused
          const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode <= 299;
          if (ok) {
            resolve();
          } else {
            reject(new Error(`Collector returned HTTP ${res.statusCode} — verify your api_key and collector_url`));
          }
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Collector request timed out')); });
        req.write(body);
        req.end();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Validators (shared logic with private_host_cases.json fixture)
// ---------------------------------------------------------------------------

export function validateCollectorUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error(
      `Apidepth collector_url must use HTTPS (got ${url.protocol}). ` +
      'HTTP connections are rejected to prevent SSRF and credential exposure.',
    );
  }

  let host = url.hostname.toLowerCase();

  // Expand pure-integer hosts (decimal IP notation, e.g. "2130706433") to dotted-quad.
  if (/^\d+$/.test(host)) {
    const n = parseInt(host, 10);
    if (n >= 0 && n <= 0xFFFFFFFF) {
      host = [(n >>> 24), (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
    }
  }

  if (!host || PRIVATE_HOST_RE.test(host)) {
    throw new Error(
      `Apidepth collector_url must not target private, loopback, or link-local addresses (got ${url.hostname}).`,
    );
  }
}

export function validateApiKey(key: string): void {
  if (/[\r\n\x00]/.test(key)) {
    throw new Error(
      'Apidepth api_key contains illegal characters (line-break or NUL). ' +
      'This may indicate header injection — check your APIDEPTH_API_KEY value.',
    );
  }
}

export function sdkMetadata(): Record<string, unknown> {
  return {
    name:             'apidepth-javascript',
    version:          VERSION,
    node_version:     process.version,
    node_platform:    process.platform,
    os_release:       os.release(),
    runtime_env:      detectRuntimeEnv(),
  };
}

function detectRuntimeEnv(): string {
  if (process.env['NEXT_RUNTIME']) return 'nextjs';
  if (process.env['VERCEL'])       return 'vercel';
  if (process.env['AWS_LAMBDA_FUNCTION_NAME']) return 'lambda';
  if (process.env['K_SERVICE'])    return 'cloud-run';
  return 'unknown';
}
