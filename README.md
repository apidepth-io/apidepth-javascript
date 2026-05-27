# apidepth

[![npm version](https://img.shields.io/npm/v/apidepth)](https://www.npmjs.com/package/apidepth)
[![Node.js](https://img.shields.io/badge/node-%3E%3D%2018-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Most API monitoring tools measure latency from their servers to the vendor. That's not what your users feel. Apidepth instruments `http`, `https`, and `fetch` directly — every outbound call your app makes to Stripe, OpenAI, or Twilio is timed at the socket level, from your server. Then it benchmarks your numbers against anonymized fleet data, so when Stripe is slow you can tell if it's you or everyone.

No payload capture. No credentials touch our infrastructure. No changes to your application code beyond a one-time initializer.

---

## How it works

**Real traffic, not synthetic probes.** Every outbound HTTP call your application makes to a known vendor is timed at the socket level, tagged with outcome and environment metadata, and batched to the Apidepth collector in the background. The latency number in your dashboard is the number your users feel — not a probe running from a data center somewhere else.

**Fleet benchmarking.** Because Apidepth aggregates anonymized timing data across all customers, your dashboard shows not just "your Stripe p95 is 420ms" but "the fleet median is 280ms — you may have a regional routing issue." That comparison is only possible with real traffic from real deployments.

**Proof of Innocence.** When all endpoints to a vendor spike simultaneously, Apidepth surfaces a verdict: _isolated_ (the spike is yours alone) or _tracking_ (the fleet sees the same thing — vendor-side). The attribution card makes it fast to tell ops "it's Stripe, not us."

**Rate limit intelligence.** Apidepth tracks 429 patterns and projects quota burn-down before you hit the ceiling — with a burn-down card showing time-to-throttle at current request rate.

---

## Installation

```
npm install apidepth
```

---

## Getting started

```ts
import Apidepth from "apidepth";

Apidepth.configure({
  apiKey: process.env.APIDEPTH_API_KEY,
  environment: process.env.NODE_ENV,
});
Apidepth.instrument();
```

Call `instrument()` once at process startup, before any outbound requests are made. After that, all calls via `node:http`, `node:https`, and the global `fetch` to recognised vendor hosts are captured automatically — no changes at call sites.

Get your API key at [apidepth.io](https://apidepth.io).

---

## Framework integrations

### Express

```ts
import express from "express";
import { apidepthMiddleware } from "apidepth/integrations/express";

const app = express();

app.use(
  apidepthMiddleware({
    apiKey: process.env.APIDEPTH_API_KEY,
    environment: process.env.NODE_ENV,
  })
);
```

The middleware configures and instruments on first mount, then calls `next()` on every request — it adds no per-request overhead.

### Next.js

Create or add to `src/instrumentation.ts` in your Next.js app:

```ts
import { register as apidepthRegister } from "apidepth/integrations/nextjs";

export async function register() {
  await apidepthRegister({
    apiKey: process.env.APIDEPTH_API_KEY,
    environment: process.env.NODE_ENV,
  });
}
```

Next.js calls `instrumentation.ts` once per runtime. Apidepth instruments only the Node.js runtime — it skips the Edge runtime because edge workers use Web APIs rather than `node:http`/`https`.

Enable the instrumentation hook in `next.config.ts` if you haven't already:

```ts
const nextConfig = {
  experimental: { instrumentationHook: true },
};
export default nextConfig;
```

---

## Configuration

All options with their defaults:

```ts
Apidepth.configure({
  // Required. Your account API key.
  apiKey: process.env.APIDEPTH_API_KEY,

  // Tag applied to every event. Use this to distinguish environments
  // in your dashboard. Default: null
  environment: "production",

  // Set false to disable all instrumentation (e.g. in test environments).
  // Default: true
  enabled: true,

  // Fraction of events to capture. 1.0 = 100%, 0.1 = 10%.
  // Lower this if your application makes thousands of vendor calls per minute.
  // Default: 1.0
  sampleRate: 1.0,

  // Hostnames to exclude from instrumentation entirely.
  // Default: []
  ignoredHosts: ["api.internal.mycompany.com"],

  // How often (in seconds) queued events are batched and sent.
  // Default: 20
  flushInterval: 20,

  // Path for the local vendor registry cache.
  // Default: '/tmp/apidepth_registry.json'
  registryCachePath: "/tmp/apidepth_registry.json",

  // Custom vendors your app calls that aren't in the global registry.
  // Key: vendor name shown in your dashboard.
  // Value: the hostname the SDK should watch for.
  // Mappings sync to your dashboard on the next event flush.
  // Default: {}
  extraVendors: {
    "my-payments-api": "api.payments.internal.com",
    fulfillment: "fulfillment.myco.io",
  },

  // Called on every flush failure, in addition to the built-in warn log.
  // Use this to route failures to your existing error tracker.
  // Default: null
  onFlushError: (err, ctx) => {
    Sentry.captureException(err, { extra: ctx });
  },

  // Override the collector endpoint. Only useful for self-hosted deployments.
  // Default: 'https://collector.apidepth.io/v1/events'
  collectorUrl: "https://collector.apidepth.io/v1/events",
});
```

---

## What gets captured

Every event contains:

| Field         | Description                                                                       |
| ------------- | --------------------------------------------------------------------------------- |
| `vendor`      | Vendor slug, e.g. `"stripe"`, `"openai"`                                          |
| `endpoint`    | Normalized path, e.g. `"/v1/charges/:id"`                                         |
| `method`      | HTTP verb: `"GET"`, `"POST"`, etc.                                                |
| `status`      | HTTP status code, or `null` on timeout                                            |
| `outcome`     | `"success"`, `"client_error"`, `"server_error"`, `"timeout"`, `"unknown"`         |
| `duration_ms` | Wall-clock time in milliseconds, including DNS and TLS on first connection        |
| `cold_start`  | `true` if this request paid for the TLS handshake; excluded from p95 calculations |
| `env`         | Environment tag from `environment` config option                                  |
| `ts`          | Unix timestamp in milliseconds                                                    |
| `rl_remaining` | Remaining quota, e.g. `4999` — present when vendor rate limit headers are found  |
| `rl_limit`    | Total quota, e.g. `5000` — present when vendor rate limit headers are found       |
| `rl_reset_at` | Quota reset time in epoch milliseconds — present when vendor rate limit headers are found |

### What is never captured

- Request or response **bodies**
- Request or response **headers** (including Authorization)
- **Query string parameters**
- Any credential, token, or secret your application uses to authenticate with a vendor
- User identifiers or PII of any kind

Path normalization strips resource IDs before the event leaves your server. `/v1/charges/ch_3Ox4Kz2e` becomes `/v1/charges/:id`.

---

## Rate limit headers

Apidepth automatically reads vendor rate-limit headers on every response. No configuration required. The following header names are checked in priority order:

| Field     | Headers checked                                                                     |
| --------- | ----------------------------------------------------------------------------------- |
| remaining | `x-ratelimit-remaining-requests`, `x-ratelimit-remaining`, `ratelimit-remaining`    |
| limit     | `x-ratelimit-limit-requests`, `x-ratelimit-limit`, `ratelimit-limit`                |
| reset_at  | `x-ratelimit-reset-requests`, `x-ratelimit-reset`, `ratelimit-reset`, `retry-after` |

The `reset_at` value is normalized to epoch milliseconds regardless of vendor format:

- **Unix timestamp** (`n ≥ 1 × 10⁹`) — GitHub, HubSpot, IETF draft
- **Seconds from now** (small integer) — Stripe `Retry-After` on 429
- **Duration string** (`"1s"`, `"20ms"`, `"1m30s"`) — OpenAI, Anthropic

Vendors with no quota headers on 2xx responses still contribute to 429 frequency tracking — the collector counts `status = 429` events regardless of header availability.

---

## Cluster / worker processes

Each worker process needs its own collector instance. Call `Apidepth.reset()` in each worker on startup:

```ts
// cluster setup
cluster.on("fork", (worker) => {
  worker.once("online", () => {
    // workers run this in their own process
  });
});

// inside each worker process
Apidepth.reset();
Apidepth.configure({ apiKey: process.env.APIDEPTH_API_KEY });
Apidepth.instrument();
```

To flush the primary process queue before forking:

```ts
import { Collector } from "apidepth";

// before fork
await Collector.getInstance().flush();

// in each worker
Apidepth.reset();
```

---

## Debugging

Inspect the collector's internal state at any time:

```ts
import { Collector } from "apidepth";

console.log(Collector.getInstance().stats());
// {
//   queueSize: 0,
//   consecutiveFailures: 0,
//   totalDropped: 0,
//   lastFlushAt: 1747959127000
// }
```

`lastFlushAt` is only updated when events are actually delivered to the collector. If it's `null` or stale, check your `apiKey` and network connectivity.

`totalDropped` counts events discarded due to backpressure (queue full, max 5,000 events). A non-zero value means your flush interval is too long for your traffic volume — lower `flushInterval` or reduce `sampleRate` below `1.0`.

To enable debug-level logging:

```ts
Apidepth.setLogger({
  debug: (msg) => console.debug(msg),
  info: (msg) => console.info(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
});
```

The default logger writes `warn` and `error` to `console`. Set a no-op logger to silence all output:

```ts
Apidepth.setLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
```

---

## Compatibility

|            | Minimum        |
| ---------- | -------------- |
| Node.js    | 18             |
| TypeScript | 5.0 (optional) |

The SDK instruments `node:http` and `node:https` at the module level. Most HTTP clients in the Node.js ecosystem (`axios`, `got`, `node-fetch`, `undici` in Node.js ≥ 18 via `fetch`) make requests through these modules and are instrumented automatically without additional configuration.

**ESM and CJS** are both supported. The package ships dual bundles (`dist/index.mjs` for ESM, `dist/index.js` for CJS) with full TypeScript declarations.

---

## Contributing

```
git clone https://github.com/apidepth-io/apidepth-javascript
cd apidepth-javascript
npm install
npm test
```

The test suite requires no external services.

To verify the build:

```
npm run build
npm run typecheck
```

---

## License

MIT. See [LICENSE](LICENSE).
