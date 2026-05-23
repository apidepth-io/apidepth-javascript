import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Collector } from '../src/collector.js';
import { resetConfiguration, getConfiguration } from '../src/configuration.js';
import { VendorRegistry, BUNDLED_BASELINE, type RegistryJson } from '../src/vendor_registry.js';
import { setLogger } from '../src/logger.js';
import { loadAndStart, resetRegistryLoader } from '../src/registry_loader.js';

function captureWarns(): { warns: string[]; restore: () => void } {
  const warns: string[] = [];
  setLogger({ debug: () => {}, warn: (m) => warns.push(m), error: () => {} });
  return { warns, restore: () => setLogger({ debug: () => {}, warn: () => {}, error: () => {} }) };
}

// Fake https.request that sends a real HTTP response with the given status + body.
// Registers the callback (2nd or 3rd arg) as a response listener — matching how
// Node's real http.request works — so registry_loader's response handler fires.
function mockHttpsSuccess(statusCode: number, body: string): typeof https.request {
  return function fakeRequest(...args: Parameters<typeof https.request>) {
    const callback =
      typeof args[1] === 'function' ? args[1] as (r: unknown) => void
      : typeof args[2] === 'function' ? args[2] as (r: unknown) => void
      : undefined;

    const req = new EventEmitter() as ReturnType<typeof https.request>;
    (req as unknown as { end: () => void; destroy: () => void }).end     = () => {};
    (req as unknown as { end: () => void; destroy: () => void }).destroy = () => {};

    const res = new EventEmitter() as import('node:http').IncomingMessage;
    (res as unknown as { statusCode: number }).statusCode = statusCode;
    (res as unknown as { resume: () => void }).resume = () => {};

    if (callback) req.once('response', callback);

    process.nextTick(() => {
      req.emit('response', res);
      process.nextTick(() => {
        res.emit('data', Buffer.from(body));
        process.nextTick(() => res.emit('end'));
      });
    });
    return req;
  } as unknown as typeof https.request;
}

// Fake https.request that immediately errors — causes _fetchRemote to return null.
function mockHttpsError(): typeof https.request {
  return function fakeRequest() {
    const req = new EventEmitter() as ReturnType<typeof https.request>;
    (req as unknown as { end: () => void; destroy: () => void }).end     = () => {};
    (req as unknown as { end: () => void; destroy: () => void }).destroy = () => {};
    process.nextTick(() => req.emit('error', new Error('network unreachable')));
    return req;
  } as unknown as typeof https.request;
}

let originalRequest: typeof https.request;

beforeEach(() => {
  Collector.reset();
  resetConfiguration();
  resetRegistryLoader();
  VendorRegistry.replace(BUNDLED_BASELINE);
  originalRequest = https.request;
  // Prevent disk cache bleed — unique path per test so no test reads another's write
  getConfiguration().registryCachePath = `/tmp/apidepth_no_cache_${process.pid}_${Date.now()}.json`;
});

afterEach(() => {
  (https as unknown as { request: typeof https.request }).request = originalRequest;
  setLogger({ debug: () => {}, warn: () => {}, error: () => {} });
});

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe('registry cache path validation', () => {
  it('warns and does not throw for a relative cache path', async () => {
    getConfiguration().registryCachePath = 'relative/path.json';
    (https as unknown as { request: typeof https.request }).request = mockHttpsError();

    const { warns, restore } = captureWarns();
    loadAndStart();
    await new Promise(r => setTimeout(r, 60));

    expect(warns.some(w => /absolute path|registry_cache_path/i.test(w))).toBe(true);
    restore();
  });

  it('warns and does not throw for a path containing ..', async () => {
    getConfiguration().registryCachePath = '/tmp/../etc/passwd';
    (https as unknown as { request: typeof https.request }).request = mockHttpsError();

    const { warns, restore } = captureWarns();
    loadAndStart();
    await new Promise(r => setTimeout(r, 60));

    expect(warns.some(w => /traversal|registry_cache_path/i.test(w))).toBe(true);
    restore();
  });
});

// ---------------------------------------------------------------------------
// Disk cache fallback
// ---------------------------------------------------------------------------

describe('disk cache fallback', () => {
  it('loads the registry from disk when the remote fetch fails', async () => {
    const tmpFile = path.join(os.tmpdir(), `apidepth_test_${Date.now()}.json`);
    const diskRegistry: RegistryJson = {
      version: 'disk-v1',
      vendors: {
        diskvendor: {
          hosts: ['api.diskvendor.test'],
          patterns: [],
        },
      },
    };
    fs.writeFileSync(tmpFile, JSON.stringify(diskRegistry), 'utf8');

    getConfiguration().registryCachePath = tmpFile;
    (https as unknown as { request: typeof https.request }).request = mockHttpsError();

    loadAndStart();
    await new Promise(r => setTimeout(r, 60));

    expect(VendorRegistry.version).toBe('disk-v1');

    fs.unlinkSync(tmpFile);
  });
});

// ---------------------------------------------------------------------------
// Remote registry fetch
// ---------------------------------------------------------------------------

describe('remote registry fetch', () => {
  it('updates the registry from the remote response', async () => {
    const remoteRegistry: RegistryJson = {
      version: 'remote-v42',
      vendors: { remotevendor: { hosts: ['api.remotevendor.test'], patterns: [] } },
    };
    (https as unknown as { request: typeof https.request }).request =
      mockHttpsSuccess(200, JSON.stringify(remoteRegistry));

    loadAndStart();
    await new Promise(r => setTimeout(r, 100));

    expect(VendorRegistry.version).toBe('remote-v42');
  });

  it('emits a stale-vendor warning from registry warnings', async () => {
    const remoteRegistry: RegistryJson = {
      version: 'v1',
      vendors: {},
      warnings: { stale_vendors: ['old-vendor'] },
    };
    (https as unknown as { request: typeof https.request }).request =
      mockHttpsSuccess(200, JSON.stringify(remoteRegistry));

    const { warns, restore } = captureWarns();
    loadAndStart();
    await new Promise(r => setTimeout(r, 100));

    expect(warns.some(w => /old-vendor/.test(w) && /7\+ days/i.test(w))).toBe(true);
    restore();
  });

  it('emits a conflict warning when extraVendors disagrees with the remote', async () => {
    getConfiguration().extraVendors = { 'my-api': 'local.my-api.com' };
    const remoteRegistry: RegistryJson = {
      version: 'v1',
      vendors: {},
      customer_vendors: { 'my-api': 'remote.my-api.com' },
    };
    (https as unknown as { request: typeof https.request }).request =
      mockHttpsSuccess(200, JSON.stringify(remoteRegistry));

    const { warns, restore } = captureWarns();
    loadAndStart();
    await new Promise(r => setTimeout(r, 100));

    expect(warns.some(w => /my-api/.test(w) && /conflict/i.test(w))).toBe(true);
    restore();
  });

  it('ignores a non-200 response and leaves registry unchanged', async () => {
    (https as unknown as { request: typeof https.request }).request =
      mockHttpsSuccess(503, '');

    loadAndStart();
    await new Promise(r => setTimeout(r, 100));

    // No update from remote — version stays at bundled baseline
    expect(VendorRegistry.version).toBe('bundled');
  });

  it('warns and skips when the response body exceeds 512 KB', async () => {
    const bigChunk = Buffer.alloc(513_000, 'x');

    (https as unknown as { request: typeof https.request }).request = function fakeRequest(
      ...args: Parameters<typeof https.request>
    ) {
      const callback =
        typeof args[1] === 'function' ? args[1] as (r: unknown) => void
        : typeof args[2] === 'function' ? args[2] as (r: unknown) => void
        : undefined;

      const req = new EventEmitter() as ReturnType<typeof https.request>;
      (req as unknown as { end: () => void; destroy: () => void }).end     = () => {};
      (req as unknown as { end: () => void; destroy: () => void }).destroy = () => {};

      const res = new EventEmitter() as import('node:http').IncomingMessage;
      (res as unknown as { statusCode: number }).statusCode = 200;
      (res as unknown as { resume: () => void; destroy: () => void }).resume  = () => {};
      (res as unknown as { resume: () => void; destroy: () => void }).destroy = () => {};

      if (callback) req.once('response', callback);

      process.nextTick(() => {
        req.emit('response', res);
        process.nextTick(() => res.emit('data', bigChunk));
      });
      return req;
    } as unknown as typeof https.request;

    const { warns, restore } = captureWarns();
    loadAndStart();
    await new Promise(r => setTimeout(r, 100));

    expect(warns.some(w => /too large/i.test(w))).toBe(true);
    restore();
  });
});
