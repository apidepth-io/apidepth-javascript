/**
 * Tests for the CLI test subcommand.
 *
 * Covers:
 *   - runTest: exits with message when no API key configured
 *   - runTest: calls the collector and prints success
 *   - runTest: handles non-2xx responses (401, 500)
 *   - runTest: handles connection errors (ECONNREFUSED, SSL)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";

// --- mock node:https BEFORE importing testCmd ---
// vi.mock is hoisted; use vi.hoisted so the factory can reference mockRequest
const mockRequest = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({
  default: { request: mockRequest },
}));
vi.mock("node:http", () => ({
  default: { request: mockRequest },
}));

import { runTest } from "../src/cli/testCmd.js";

// --- helpers ---

function makeResponse(statusCode: number): IncomingMessage {
  const res = new EventEmitter() as IncomingMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).statusCode = statusCode;
  res.resume = vi.fn();
  return res;
}

function makeReq() {
  const req = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).write = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).end = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).setTimeout = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).destroy = vi.fn();
  return req;
}

// --- test setup ---

const originalExit = process.exit;
const originalEnv = { ...process.env };
let stdoutChunks: string[];
let stderrChunks: string[];

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : "");
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : "");
    return true;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = vi.fn();
  delete process.env.APIDEPTH_API_KEY;
  delete process.env.APIDEPTH_COLLECTOR_URL;
  mockRequest.mockReset();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = originalExit;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// --- tests ---

describe("runTest — no API key", () => {
  it("exits with code 1 and prints helpful message", async () => {
    await runTest([]);
    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("No API key");
  });
});

describe("runTest — HTTP 200 success", () => {
  it("prints success tick and does not exit", async () => {
    process.env.APIDEPTH_API_KEY = "apid_live_test";
    const req = makeReq();
    const res = makeResponse(200);

    mockRequest.mockImplementation((_opts: unknown, cb?: (r: IncomingMessage) => void) => {
      setTimeout(() => {
        cb?.(res);
        res.emit("end");
      }, 0);
      return req;
    });

    await runTest([]);

    const out = stdoutChunks.join("");
    expect(out).toContain("✓");
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe("runTest — HTTP 401", () => {
  it("exits 1 with key-not-recognised message", async () => {
    process.env.APIDEPTH_API_KEY = "bad_key";
    const req = makeReq();
    const res = makeResponse(401);

    mockRequest.mockImplementation((_opts: unknown, cb?: (r: IncomingMessage) => void) => {
      setTimeout(() => {
        cb?.(res);
        res.emit("end");
      }, 0);
      return req;
    });

    await runTest([]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("API key not recognised");
  });
});

describe("runTest — HTTP 500", () => {
  it("exits 1 and includes status code in message", async () => {
    process.env.APIDEPTH_API_KEY = "apid_live_test";
    const req = makeReq();
    const res = makeResponse(500);

    mockRequest.mockImplementation((_opts: unknown, cb?: (r: IncomingMessage) => void) => {
      setTimeout(() => {
        cb?.(res);
        res.emit("end");
      }, 0);
      return req;
    });

    await runTest([]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("500");
  });
});

describe("runTest — ECONNREFUSED", () => {
  it("exits 1 and prints 'Could not reach collector'", async () => {
    process.env.APIDEPTH_API_KEY = "apid_live_test";
    const req = makeReq();

    mockRequest.mockImplementation(() => {
      setTimeout(() => {
        const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
          code: "ECONNREFUSED",
        });
        req.emit("error", err);
      }, 0);
      return req;
    });

    await runTest([]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("Could not reach collector");
  });
});

describe("runTest — SSL error", () => {
  it("exits 1 and prints SSL message", async () => {
    process.env.APIDEPTH_API_KEY = "apid_live_test";
    const req = makeReq();

    mockRequest.mockImplementation(() => {
      setTimeout(() => {
        req.emit("error", new Error("ssl certificate verify failed"));
      }, 0);
      return req;
    });

    await runTest([]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("SSL");
  });
});

describe("runTest — generic connection error", () => {
  it("exits 1 and prints connection error", async () => {
    process.env.APIDEPTH_API_KEY = "apid_live_test";
    const req = makeReq();

    mockRequest.mockImplementation(() => {
      setTimeout(() => {
        req.emit("error", new Error("something unexpected"));
      }, 0);
      return req;
    });

    await runTest([]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const err = stderrChunks.join("");
    expect(err).toContain("Connection error");
  });
});
