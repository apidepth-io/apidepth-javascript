import { describe, it, expect, beforeEach, vi } from "vitest";
import { Collector } from "../src/collector.js";
import { resetConfiguration, getConfiguration } from "../src/configuration.js";
import { resetInstrumentation } from "../src/instrumentation.js";
import { resetRegistryLoader } from "../src/registry_loader.js";
import Apidepth, { flush } from "../src/index.js";
import { apidepthMiddleware } from "../src/integrations/express.js";
import { register } from "../src/integrations/nextjs.js";
import type { Request, Response, NextFunction } from "express";

beforeEach(() => {
  Collector.reset();
  resetConfiguration();
  resetInstrumentation();
  resetRegistryLoader();
  delete process.env["NEXT_RUNTIME"];
});

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

describe("apidepthMiddleware", () => {
  it("returns a function", () => {
    const mw = apidepthMiddleware({ apiKey: "test-key" });
    expect(typeof mw).toBe("function");
  });

  it("calls next() on every request", () => {
    const mw = apidepthMiddleware({ apiKey: "test-key" });
    const next = vi.fn() as unknown as NextFunction;
    mw({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("applies configuration options", () => {
    apidepthMiddleware({ apiKey: "express-key", environment: "staging" });
    expect(getConfiguration().apiKey).toBe("express-key");
    expect(getConfiguration().environment).toBe("staging");
  });

  it("does not throw when given an invalid option", () => {
    // configure() throws internally; the middleware must swallow it
    expect(() =>
      apidepthMiddleware({ unknownOption: "oops" } as Parameters<typeof apidepthMiddleware>[0])
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Next.js
// ---------------------------------------------------------------------------

describe("register (Next.js)", () => {
  it("configures the SDK in the Node.js runtime", async () => {
    await register({ apiKey: "nextjs-key", environment: "production" });
    expect(getConfiguration().apiKey).toBe("nextjs-key");
    expect(getConfiguration().environment).toBe("production");
  });

  it("skips instrumentation in the Edge runtime", async () => {
    process.env["NEXT_RUNTIME"] = "edge";
    await register({ apiKey: "edge-key" });
    // configure() was never called — apiKey should remain null
    expect(getConfiguration().apiKey).toBeNull();
  });

  it("does not throw when an invalid option is passed", async () => {
    await expect(
      register({ unknownOption: "oops" } as Parameters<typeof register>[0])
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Apidepth.reset() — fork/cluster safety
// ---------------------------------------------------------------------------

describe("Apidepth.reset()", () => {
  it("clears the registry loader so instrument() bootstraps again after reset", () => {
    Apidepth.configure({ apiKey: "test-key" });
    Apidepth.instrument();
    Apidepth.reset();
    // After reset, instrument() must be able to run loadAndStart() again (not hit the guard).
    // We verify indirectly: the Collector singleton is fresh after reset.
    expect(Collector.getInstance().stats().queueSize).toBe(0);
    // And configuration is cleared
    expect(getConfiguration().apiKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// flush() public API
// ---------------------------------------------------------------------------

describe("flush() named export", () => {
  it("resolves without error when the queue is empty", async () => {
    await expect(flush()).resolves.toBeUndefined();
  });

  it("is also accessible on the default export", async () => {
    await expect(Apidepth.flush()).resolves.toBeUndefined();
  });
});
