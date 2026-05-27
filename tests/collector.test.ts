import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Collector,
  validateCollectorUrl,
  validateApiKey,
  sdkMetadata,
  MAX_QUEUE_SIZE,
  MAX_BATCH_SIZE,
  FAILURE_THRESHOLD,
} from "../src/collector.js";
import { resetConfiguration, getConfiguration } from "../src/configuration.js";
import { setLogger } from "../src/logger.js";
import type { ApidepthEvent } from "../src/event.js";
import https from "node:https";
import { EventEmitter } from "node:events";

const makeEvent = (overrides: Partial<ApidepthEvent> = {}): ApidepthEvent => ({
  vendor: "stripe",
  endpoint: "/v1/charges",
  method: "POST",
  status: 200,
  outcome: "success",
  duration_ms: 100,
  cold_start: false,
  env: "test",
  ts: Date.now(),
  ...overrides,
});

beforeEach(() => {
  Collector.reset();
  resetConfiguration();
});

describe("Collector singleton", () => {
  it("returns the same instance", () => {
    expect(Collector.getInstance()).toBe(Collector.getInstance());
  });

  it("reset() returns a fresh instance", () => {
    const first = Collector.getInstance();
    Collector.reset();
    expect(Collector.getInstance()).not.toBe(first);
  });
});

describe("Collector.record", () => {
  it("enqueues events", () => {
    const c = Collector.getInstance();
    c.record(makeEvent());
    expect(c.stats().queueSize).toBe(1);
  });

  it("drops events when queue is full", () => {
    const c = Collector.getInstance();
    for (let i = 0; i < MAX_QUEUE_SIZE + 10; i++) c.record(makeEvent());
    expect(c.stats().queueSize).toBe(MAX_QUEUE_SIZE);
    expect(c.stats().totalDropped).toBe(10);
  });
});

describe("validateCollectorUrl", () => {
  const valid = (url: string) => () => validateCollectorUrl(new URL(url));
  const _invalid = (url: string) => () => validateCollectorUrl(new URL(url));

  it("accepts a valid HTTPS URL", () => {
    expect(valid("https://collector.apidepth.io/v1/events")).not.toThrow();
  });

  it("rejects HTTP", () => {
    expect(() => validateCollectorUrl(new URL("http://collector.apidepth.io/"))).toThrow(/HTTPS/);
  });

  const privateHosts = [
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.1/v1",
    "https://192.168.1.1/v1",
    "https://172.16.0.1/v1",
    "https://169.254.0.1/v1",
    "https://[::1]/v1",
  ];
  it.each(privateHosts)("rejects private host %s", (url) => {
    expect(() => validateCollectorUrl(new URL(url))).toThrow(/private|loopback|link-local/i);
  });

  it("rejects decimal-encoded loopback (SSRF via integer IP notation)", () => {
    // 2130706433 == 127.0.0.1 in decimal
    expect(() => validateCollectorUrl(new URL("https://2130706433/v1/events"))).toThrow(
      /private|loopback|link-local/i
    );
  });
});

describe("sdkMetadata", () => {
  it("returns an object with expected keys", () => {
    const meta = sdkMetadata();
    expect(meta).toMatchObject({
      name: "apidepth-javascript",
      node_version: expect.any(String),
      node_platform: expect.any(String),
    });
  });

  it("returns a fresh copy each call (not the internal object)", () => {
    const a = sdkMetadata();
    const b = sdkMetadata();
    expect(a).not.toBe(b);
  });
});

describe("validateApiKey", () => {
  it("accepts a normal key", () => {
    expect(() => validateApiKey("apd_live_abc123")).not.toThrow();
  });

  it("rejects keys with line-break characters", () => {
    expect(() => validateApiKey("key\ninjected")).toThrow(/line-break/);
    expect(() => validateApiKey("key\rinjected")).toThrow(/line-break/);
  });

  it("rejects keys with NUL", () => {
    expect(() => validateApiKey("key\x00injected")).toThrow(/NUL/);
  });
});

// ---------------------------------------------------------------------------
// Flush failure behaviour
// ---------------------------------------------------------------------------

function makeFailingRequest(): ReturnType<typeof https.request> {
  const req = new EventEmitter() as ReturnType<typeof https.request>;
  (req as unknown as { write: () => void; end: () => void }).write = () => {};
  (req as unknown as { write: () => void; end: () => void }).end = () => {};
  process.nextTick(() => req.emit("error", new Error("connection refused")));
  return req;
}

describe("Collector SIGTERM drain", () => {
  it("drains a queue larger than MAX_BATCH_SIZE on flush loop", async () => {
    // Simulate a successful send so we can verify multiple batches are sent.
    const sentBatches: number[] = [];
    const originalRequest = https.request;
    (https as unknown as { request: typeof https.request }).request = function fakeRequest(
      ...args: Parameters<typeof https.request>
    ) {
      const callback =
        typeof args[1] === "function"
          ? (args[1] as (r: unknown) => void)
          : typeof args[2] === "function"
            ? (args[2] as (r: unknown) => void)
            : undefined;
      const req = new EventEmitter() as ReturnType<typeof https.request>;
      (req as unknown as { write: (b: Buffer) => void; end: () => void }).write = (b: Buffer) => {
        const payload = JSON.parse(b.toString()) as { batch: unknown[] };
        sentBatches.push(payload.batch.length);
      };
      (req as unknown as { write: (b: Buffer) => void; end: () => void }).end = () => {};
      const res = new EventEmitter() as import("node:http").IncomingMessage;
      (res as unknown as { statusCode: number; resume: () => void }).statusCode = 200;
      (res as unknown as { statusCode: number; resume: () => void }).resume = () => {};
      if (callback) req.once("response", callback);
      process.nextTick(() => {
        req.emit("response", res);
      });
      return req;
    } as unknown as typeof https.request;

    getConfiguration().apiKey = "test-key";
    const c = Collector.getInstance();
    const total = MAX_BATCH_SIZE * 2 + 10;
    for (let i = 0; i < total; i++) c.record(makeEvent());
    expect(c.stats().queueSize).toBe(total);

    // Drain all batches
    while (c.stats().queueSize > 0) await c.flush();

    expect(c.stats().queueSize).toBe(0);
    expect(sentBatches.reduce((a, b) => a + b, 0)).toBe(total);

    (https as unknown as { request: typeof https.request }).request = originalRequest;
  });
});

describe("Collector flush failures", () => {
  let originalRequest: typeof https.request;

  beforeEach(() => {
    originalRequest = https.request;
    (https as unknown as { request: typeof https.request }).request =
      makeFailingRequest as unknown as typeof https.request;
  });

  afterEach(() => {
    (https as unknown as { request: typeof https.request }).request = originalRequest;
    setLogger({ debug: () => {}, warn: () => {}, error: () => {} });
  });

  it("invokes onFlushError with the error and context on failure", async () => {
    getConfiguration().apiKey = "test-key";
    const calls: Array<{
      err: Error;
      ctx: Parameters<NonNullable<typeof getConfiguration>["onFlushError"]>[1];
    }> = [];
    getConfiguration().onFlushError = (err, ctx) => calls.push({ err, ctx });

    const c = Collector.getInstance();
    c.record(makeEvent());
    await c.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].err.message).toMatch(/connection refused/);
    expect(calls[0].ctx.droppedEvents).toBe(1);
  });

  it(`increments consecutiveFailures to ${FAILURE_THRESHOLD} after ${FAILURE_THRESHOLD} failures`, async () => {
    getConfiguration().apiKey = "test-key";

    const c = Collector.getInstance();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      c.record(makeEvent());
      await c.flush();
    }

    expect(c.stats().consecutiveFailures).toBe(FAILURE_THRESHOLD);
  });
});
