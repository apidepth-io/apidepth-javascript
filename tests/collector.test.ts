import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Collector, validateCollectorUrl, validateApiKey, MAX_QUEUE_SIZE } from '../src/collector.js';
import { resetConfiguration, getConfiguration } from '../src/configuration.js';
import type { ApidepthEvent } from '../src/event.js';

const makeEvent = (overrides: Partial<ApidepthEvent> = {}): ApidepthEvent => ({
  vendor: 'stripe', endpoint: '/v1/charges', method: 'POST',
  status: 200, outcome: 'success', duration_ms: 100,
  cold_start: false, env: 'test', ts: Date.now(),
  ...overrides,
});

beforeEach(() => {
  Collector.reset();
  resetConfiguration();
});

describe('Collector singleton', () => {
  it('returns the same instance', () => {
    expect(Collector.getInstance()).toBe(Collector.getInstance());
  });

  it('reset() returns a fresh instance', () => {
    const first = Collector.getInstance();
    Collector.reset();
    expect(Collector.getInstance()).not.toBe(first);
  });
});

describe('Collector.record', () => {
  it('enqueues events', () => {
    const c = Collector.getInstance();
    c.record(makeEvent());
    expect(c.stats().queueSize).toBe(1);
  });

  it('drops events when queue is full', () => {
    const c = Collector.getInstance();
    for (let i = 0; i < MAX_QUEUE_SIZE + 10; i++) c.record(makeEvent());
    expect(c.stats().queueSize).toBe(MAX_QUEUE_SIZE);
    expect(c.stats().totalDropped).toBe(10);
  });
});

describe('validateCollectorUrl', () => {
  const valid = (url: string) => () => validateCollectorUrl(new URL(url));
  const invalid = (url: string) => () => validateCollectorUrl(new URL(url));

  it('accepts a valid HTTPS URL', () => {
    expect(valid('https://collector.apidepth.io/v1/events')).not.toThrow();
  });

  it('rejects HTTP', () => {
    expect(() => validateCollectorUrl(new URL('http://collector.apidepth.io/'))).toThrow(/HTTPS/);
  });

  const privateHosts = [
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://192.168.1.1/v1',
    'https://172.16.0.1/v1',
    'https://169.254.0.1/v1',
    'https://[::1]/v1',
  ];
  it.each(privateHosts)('rejects private host %s', (url) => {
    expect(() => validateCollectorUrl(new URL(url))).toThrow(/private|loopback|link-local/i);
  });
});

describe('validateApiKey', () => {
  it('accepts a normal key', () => {
    expect(() => validateApiKey('apd_live_abc123')).not.toThrow();
  });

  it('rejects keys with line-break characters', () => {
    expect(() => validateApiKey('key\ninjected')).toThrow(/line-break/);
    expect(() => validateApiKey('key\rinjected')).toThrow(/line-break/);
  });

  it('rejects keys with NUL', () => {
    expect(() => validateApiKey('key\x00injected')).toThrow(/NUL/);
  });
});
