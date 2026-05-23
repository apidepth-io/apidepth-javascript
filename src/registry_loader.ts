// Remote vendor registry loader.
//
// Load order on startup: remote fetch → disk cache → bundled baseline.
// A background setInterval refreshes from remote every registryRefreshInterval seconds.
// Mirrors the Ruby gem's RegistryLoader and Python SDK's registry_loader.py exactly.

import https from 'node:https';
import fs from 'node:fs';
import { getConfiguration } from './configuration.js';
import { getLogger, sanitizeLog } from './logger.js';
import { VendorRegistry, type RegistryJson } from './vendor_registry.js';
import { withSkip } from './skip.js';

const REGISTRY_URL = 'https://collector.apidepth.io/v1/registry';
const MAX_RESPONSE_BYTES = 512_000;

let _conflictVendors: Record<string, { local: string; remote: string }> = {};
let _warnedStale:    Record<string, true>    = {};
let _warnedConflict: Record<string, true>    = {};

export function loadAndStart(): void {
  void _bootstrap();

  const intervalMs = Math.max(60, getConfiguration().registryRefreshInterval) * 1000;
  const timer = setInterval(async () => {
    const registry = await _fetchRemote();
    if (registry) VendorRegistry.replace(registry, getConfiguration().extraVendors);
  }, intervalMs);
  timer.unref();
}

async function _bootstrap(): Promise<void> {
  const remote = await _fetchRemote();
  const source = remote ?? _loadFromDisk();
  if (source) VendorRegistry.replace(source, getConfiguration().extraVendors);
}

async function _fetchRemote(): Promise<RegistryJson | null> {
  return new Promise<RegistryJson | null>((resolve) => {
    withSkip(() => {
      const url = new URL(REGISTRY_URL);
      const key = getConfiguration().apiKey ?? '';

      const req = https.request({
        hostname: url.hostname,
        path:     url.pathname,
        method:   'GET',
        headers:  { Authorization: `Bearer ${key}` },
        timeout:  5000,
      }, (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            getLogger().warn(`[Apidepth] Registry response too large (${totalBytes} bytes) — skipping`);
            res.destroy();
            resolve(null);
          } else {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          try {
            const body     = Buffer.concat(chunks).toString('utf8');
            const registry = JSON.parse(body) as RegistryJson;
            _applyCustomerVendors(registry);
            _emitWarnings(registry);
            _writeDiskCache(body);
            resolve(registry);
          } catch {
            resolve(null);
          }
        });

        res.on('error', () => resolve(null));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  });
}

function _loadFromDisk(): RegistryJson | null {
  try {
    const path = getConfiguration().registryCachePath;
    _validateCachePath(path);
    if (!fs.existsSync(path)) return null;
    return JSON.parse(fs.readFileSync(path, 'utf8')) as RegistryJson;
  } catch (e) {
    getLogger().warn(`[Apidepth] Could not read registry cache: ${sanitizeLog(e)}`);
    return null;
  }
}

function _writeDiskCache(body: string): void {
  try {
    const path = getConfiguration().registryCachePath;
    _validateCachePath(path);
    fs.writeFileSync(path, body, 'utf8');
  } catch (e) {
    getLogger().warn(`[Apidepth] Could not write registry cache: ${sanitizeLog(e)}`);
  }
}

function _validateCachePath(path: unknown): void {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`registry_cache_path must be an absolute path (got ${String(path)})`);
  }
  if (path.split('/').includes('..')) {
    throw new Error(`registry_cache_path must not contain '..' traversal segments (got ${path})`);
  }
}

function _applyCustomerVendors(registry: RegistryJson): void {
  const remote = registry.customer_vendors;
  if (!remote || typeof remote !== 'object') return;

  const local = getConfiguration().extraVendors ?? {};

  const clean: Record<string, string> = {};
  for (const [name, remoteHost] of Object.entries(remote)) {
    if (typeof name !== 'string' || typeof remoteHost !== 'string') continue;
    clean[name] = remoteHost;
    const localHost = local[name];
    if (localHost && localHost !== remoteHost) {
      _conflictVendors[name] = { local: localHost, remote: remoteHost };
    }
  }

  VendorRegistry.loadExtraVendors(clean);
}

function _emitWarnings(registry: RegistryJson): void {
  const stale = registry.warnings?.stale_vendors;
  if (Array.isArray(stale)) {
    for (const name of stale) {
      if (typeof name !== 'string' || _warnedStale[name]) continue;
      _warnedStale[name] = true;
      getLogger().warn(
        `[Apidepth] No events received from '${sanitizeLog(name)}' in 7+ days — ` +
        `is it still declared in extraVendors? If intentional, remove it at www.apidepth.io.`,
      );
    }
  }

  for (const [name, hosts] of Object.entries(_conflictVendors)) {
    if (_warnedConflict[name]) continue;
    _warnedConflict[name] = true;
    getLogger().warn(
      `[Apidepth] extraVendors conflict: '${sanitizeLog(name)}' is configured as ` +
      `'${hosts.local}' locally but the registry has '${hosts.remote}' — ` +
      `registry takes precedence. Update your initializer or remove the entry from your dashboard.`,
    );
  }
  _conflictVendors = {};
}
