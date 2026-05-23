import { describe, it, expect, beforeEach } from 'vitest';
import { Configuration, getConfiguration, resetConfiguration } from '../src/configuration.js';

describe('Configuration', () => {
  beforeEach(() => resetConfiguration());

  it('has expected defaults', () => {
    const c = new Configuration();
    expect(c.apiKey).toBeNull();
    expect(c.enabled).toBe(true);
    expect(c.flushInterval).toBe(20);
    expect(c.sampleRate).toBe(1.0);
    expect(c.ignoredHosts).toEqual([]);
    expect(c.extraVendors).toEqual({});
    expect(c.registryRefreshInterval).toBe(6 * 60 * 60);
    expect(c.registryCachePath).toBe('/tmp/apidepth_registry.json');
  });

  it('getConfiguration returns same singleton', () => {
    expect(getConfiguration()).toBe(getConfiguration());
  });

  it('resetConfiguration clears the singleton', () => {
    const first = getConfiguration();
    resetConfiguration();
    expect(getConfiguration()).not.toBe(first);
  });
});
