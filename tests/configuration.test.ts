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
    expect(c.ignoredHosts).toEqual([]);
    expect(c.extraVendors).toEqual({});
    expect(c.registryRefreshInterval).toBe(6 * 60 * 60);
    expect(c.registryCachePath).toBe("/tmp/apidepth_registry.json");
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
