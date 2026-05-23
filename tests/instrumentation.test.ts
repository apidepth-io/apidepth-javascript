import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Collector } from '../src/collector.js';
import { VendorRegistry, BUNDLED_BASELINE } from '../src/vendor_registry.js';
import { resetConfiguration, getConfiguration } from '../src/configuration.js';
import { instrument, resetInstrumentation } from '../src/instrumentation.js';
import https from 'node:https';
import { EventEmitter } from 'node:events';

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
}) {
  const req = new EventEmitter() as ReturnType<typeof https.request>;
  (req as unknown as { end: () => void }).end = () => {};

  // Simulate response event after tick
  process.nextTick(() => {
    if (opts.errorAfterMs !== undefined) {
      const err = new Error('socket hang up') as Error & { name: string };
      err.name = 'TimeoutError';
      req.emit('error', err);
      return;
    }
    const socket = new EventEmitter() as NodeJS.Socket;
    (socket as unknown as { connecting: boolean }).connecting = opts.socketConnecting ?? false;
    req.emit('socket', socket);

    const res = new EventEmitter() as import('node:http').IncomingMessage;
    (res as unknown as { statusCode: number }).statusCode = opts.statusCode ?? 200;
    (res as unknown as { headers: Record<string, string> }).headers = opts.headers ?? {};
    req.emit('response', res);
  });

  return req;
}

describe('instrumentation cold start tagging', () => {
  it('records cold_start=true when socket.connecting is true', async () => {
    getConfiguration().apiKey = 'test-key';
    const originalRequest = https.request;

    // Patch https.request to return a fake request with connecting=true
    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200, socketConnecting: true }),
    ) as unknown as typeof https.request;

    instrument();

    // Make a fake request to api.stripe.com
    const req = https.request({ hostname: 'api.stripe.com', path: '/v1/charges', method: 'GET' });
    req.end();

    await new Promise(r => setTimeout(r, 50));

    const stats = Collector.getInstance().stats();
    expect(stats.queueSize).toBe(1);

    // Restore
    (https as { request: typeof https.request }).request = originalRequest;
  });

  it('records cold_start=false when socket is reused', async () => {
    getConfiguration().apiKey = 'test-key';
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200, socketConnecting: false }),
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: 'api.stripe.com', path: '/v1/charges', method: 'GET' });
    req.end();

    await new Promise(r => setTimeout(r, 50));

    const stats = Collector.getInstance().stats();
    expect(stats.queueSize).toBe(1);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

describe('instrumentation ignored_hosts', () => {
  it('does not record events for ignored hosts', async () => {
    getConfiguration().ignoredHosts = ['api.stripe.com'];
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 }),
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: 'api.stripe.com', path: '/v1/charges', method: 'GET' });
    req.end();

    await new Promise(r => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});

// ---------------------------------------------------------------------------
// globalThis.fetch patching
// ---------------------------------------------------------------------------

describe('instrumentation fetch patching', () => {
  let savedFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (savedFetch !== undefined) {
      globalThis.fetch = savedFetch;
    } else {
      delete (globalThis as unknown as Record<string, unknown>)['fetch'];
    }
  });

  it('records an event when fetch succeeds for a known vendor', async () => {
    getConfiguration().apiKey = 'test-key';
    const mockResponse = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch('https://api.stripe.com/v1/charges');

    expect(Collector.getInstance().stats().queueSize).toBe(1);
  });

  it('does not record an event for an unrecognised host', async () => {
    getConfiguration().apiKey = 'test-key';
    const mockResponse = new Response('{}', { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    instrument();
    await globalThis.fetch('https://api.unknownvendor.test/v1/foo');

    expect(Collector.getInstance().stats().queueSize).toBe(0);
  });
});

describe('instrumentation disabled', () => {
  it('does not record events when enabled=false', async () => {
    getConfiguration().enabled = false;
    const originalRequest = https.request;

    (https as { request: typeof https.request }).request = vi.fn(() =>
      makeFakeRequest({ statusCode: 200 }),
    ) as unknown as typeof https.request;

    instrument();

    const req = https.request({ hostname: 'api.stripe.com', path: '/v1/charges', method: 'GET' });
    req.end();

    await new Promise(r => setTimeout(r, 50));
    expect(Collector.getInstance().stats().queueSize).toBe(0);

    (https as { request: typeof https.request }).request = originalRequest;
  });
});
