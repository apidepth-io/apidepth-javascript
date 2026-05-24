// Apidepth JavaScript SDK
//
// Tracks outbound API latency, error rates, and rate-limit quota across
// third-party vendors — Stripe, OpenAI, Anthropic, Twilio, GitHub, and more.
// Requires zero changes to existing HTTP call sites.
//
// Quick start:
//   import Apidepth from 'apidepth';
//   Apidepth.configure({ apiKey: process.env.APIDEPTH_API_KEY, environment: 'production' });
//   Apidepth.instrument(); // patches http, https, and fetch

import { Configuration, getConfiguration, resetConfiguration } from "./configuration.js";
import { getLogger, setLogger } from "./logger.js";
import { instrument as _instrument } from "./instrumentation.js";
import { Collector, sdkMetadata, validateApiKey } from "./collector.js";
import { loadAndStart, resetRegistryLoader } from "./registry_loader.js";
import { VendorRegistry } from "./vendor_registry.js";
import { VERSION } from "./version.js";

export type { Logger } from "./logger.js";
export type { FlushErrorCallback } from "./configuration.js";
export type { ApidepthEvent, Outcome } from "./event.js";
export type { RateLimitResult } from "./rate_limit_headers.js";
export { VERSION } from "./version.js";

// Valid configuration keys — used to reject typos early.
const _validKeys = new Set(Object.keys(new Configuration()));

function configure(opts: Partial<Configuration>): Configuration {
  const unknown = Object.keys(opts).filter((k) => !_validKeys.has(k));
  if (unknown.length > 0) {
    throw new TypeError(
      `Apidepth.configure() received unknown option(s): ${unknown.join(", ")}. ` +
        `Valid options: ${[..._validKeys].sort().join(", ")}.`
    );
  }
  if (opts.apiKey) validateApiKey(opts.apiKey);
  const config = getConfiguration();
  Object.assign(config, opts);
  return config;
}

function instrument(): void {
  _instrument();
  loadAndStart();
}

async function flush(): Promise<void> {
  await Collector.getInstance().flush();
}

function reset(): void {
  Collector.reset();
  resetConfiguration();
  resetRegistryLoader();
}

// Named export for ESM tree-shaking and CJS require().
const Apidepth = {
  configure,
  instrument,
  flush,
  getConfiguration,
  getLogger,
  setLogger,
  sdkMetadata,
  VendorRegistry,
  Collector,
  VERSION,

  // Cluster/fork safety — call this in each worker process on startup.
  // Equivalent to Ruby's on_worker_boot { Apidepth::Collector.reset! }
  reset,
};

export default Apidepth;
export {
  configure,
  instrument,
  flush,
  reset,
  getConfiguration,
  getLogger,
  setLogger,
  sdkMetadata,
  VendorRegistry,
  Collector,
};
