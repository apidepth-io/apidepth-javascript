import { describe, it, expect, beforeEach } from "vitest";
import { Configuration, getConfiguration, resetConfiguration } from "../src/configuration.js";
import { configure } from "../src/index.js";

describe("Configuration", () => {
  beforeEach(() => resetConfiguration());

  it("has expected defaults", () => {
    const c = new Configuration();
    expect(c.apiKey).toBeNull();
    expect(c.enabled).toBe(true);
    expect(c.flushInterval).toBe(20);
    expect(c.sampleRate).toBe(1.0);
    expect(c.extraVendors).toEqual({});
    expect(c.registryRefreshInterval).toBe(6 * 60 * 60);
    expect(c.registryCachePath).toBe("/tmp/apidepth_registry.json");
  });

  it("ignores hard-default hosts by default", () => {
    const c = new Configuration();
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "::1"]) {
      expect(c.isIgnoredHost(host)).toBe(true);
    }
  });

  it("merges user hosts with hard defaults", () => {
    const c = new Configuration();
    c.ignoredHosts = ["api.internal.example.com"];
    expect(c.isIgnoredHost("api.internal.example.com")).toBe(true);
    expect(c.isIgnoredHost("localhost")).toBe(true);
  });

  it("supports glob wildcard patterns", () => {
    const c = new Configuration();
    c.ignoredHosts = ["*.internal", "*.svc.cluster.local"];
    expect(c.isIgnoredHost("api.internal")).toBe(true);
    expect(c.isIgnoredHost("db.internal")).toBe(true);
    expect(c.isIgnoredHost("service.svc.cluster.local")).toBe(true);
    expect(c.isIgnoredHost("api.stripe.com")).toBe(false);
  });

  it("auto-ignores collector hostname when collectorUrl is set", () => {
    const c = new Configuration();
    c.collectorUrl = "https://collector.apidepth.io/v1/events";
    expect(c.isIgnoredHost("collector.apidepth.io")).toBe(true);
  });

  it("updates ignored hosts when collectorUrl changes", () => {
    const c = new Configuration();
    c.collectorUrl = "https://collector.apidepth.io/v1/events";
    c.collectorUrl = "https://custom.collector.example.com/v1/events";
    expect(c.isIgnoredHost("custom.collector.example.com")).toBe(true);
  });

  it("does not throw on malformed collectorUrl", () => {
    const c = new Configuration();
    expect(() => {
      c.collectorUrl = "not a url";
    }).not.toThrow();
  });

  it("getConfiguration returns same singleton", () => {
    expect(getConfiguration()).toBe(getConfiguration());
  });

  it("resetConfiguration clears the singleton", () => {
    const first = getConfiguration();
    resetConfiguration();
    expect(getConfiguration()).not.toBe(first);
  });
});

describe("configure() validation", () => {
  beforeEach(() => resetConfiguration());

  it("throws before mutating config when api_key contains line-break", () => {
    expect(() => configure({ apiKey: "key\ninjected", environment: "staging" })).toThrow(
      /line-break/
    );
    // environment must NOT have been applied
    expect(getConfiguration().environment).toBeNull();
  });

  it("accepts a valid api key", () => {
    configure({ apiKey: "apd_live_abc123" });
    expect(getConfiguration().apiKey).toBe("apd_live_abc123");
  });
});
