# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.1](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.1.0...apidepth-v0.1.1) (2026-05-27)


### Bug Fixes

* gitleaks allowlist for test fixture key, prettier CLAUDE.md and CONTRIBUTING.md ([3e98c64](https://github.com/apidepth-io/apidepth-javascript/commit/3e98c64c40b82d070b264a7da44d71020febb317))

## [Unreleased]

---

## [0.1.0] — 2026-05-23

Initial release.

### Added

**Core instrumentation**

- Passive outbound HTTP capture via monkey-patching `node:http` and `node:https` — instruments axios, node-fetch v2, got, and anything backed by Node's built-in HTTP stack with a single hook
- Native `fetch` instrumentation via `globalThis.fetch` patching — covers Node 18+ built-in fetch, undici, and node-fetch v3 without separate configuration
- Per-event tagging: vendor slug, normalized endpoint path, HTTP method, status code, outcome (`success`, `client_error`, `server_error`, `timeout`, `unknown`), duration in milliseconds, cold-start flag, environment, millisecond-resolution Unix timestamp
- Cold-start detection via `socket` event on `ClientRequest` — `socket.connecting === true` indicates a new TCP connection (cold start) vs. keep-alive reuse; matches the Ruby gem's behavior
- `AsyncLocalStorage`-based recursion guard — the collector's own HTTPS flush sets a skip context, preventing self-instrumentation without a thread-local or global flag
- Sample rate support — `sampleRate` (0.0–1.0) for high-traffic applications

**Vendor registry**

- Bundled baseline covering Stripe, OpenAI, Anthropic, Twilio, Resend, GitHub
- Remote registry hot-swap — vendor patterns fetched from Apidepth servers every 6 hours, applied without package update or process restart
- Three-tier fallback: remote fetch → disk cache → bundled baseline
- Path normalization strips resource IDs before events leave your server (`/v1/charges/ch_abc` → `/v1/charges/:id`)
- Generic normalizers for UUIDs, numeric IDs, and long hex tokens not covered by vendor-specific rules
- `extraVendors` config for local vendor patterns not yet in the remote registry

**Collector**

- Background flush interval batching events every 20 seconds (configurable via `flushInterval`)
- Persistent HTTPS keep-alive connection to the collector — single SSL handshake per process lifetime, not per flush
- Backpressure — events silently dropped when queue exceeds capacity; `totalDropped` counter tracks discards
- `onFlushError` callback — route flush failures to Sentry, Honeybadger, Bugsnag, or any error tracker, with `droppedEvents`, `consecutiveFailures`, and `totalDropped` in the context object
- `enabled` flag — set to `false` to disable instrumentation entirely without code changes (e.g. for test environments)

**Rate limit tracking**

- `extractRateLimitHeaders()` — parses `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`, and vendor-specific variants from response headers into a structured object
- Rate limit metadata attached to events when headers are present

**Framework integrations**

- **Express** — `apidepthMiddleware(opts)` wires configuration and instrumentation in a single `app.use()` call; the middleware itself is a no-op passthrough (outbound instrumentation is handled by the HTTP patches)
- **Next.js** — `register(opts)` for use in `src/instrumentation.ts`; automatically skips the Edge runtime (which has no `node:http`) and instruments only the Node.js runtime

**TypeScript**

- Full TypeScript source with strict mode; compiled to both ESM and CJS via tsup
- Exported types: `Configuration`, `FlushErrorCallback`, `ExpressOptions`, `NextjsOptions`
- `configure()`, `instrument()`, `getLogger()` top-level exports for manual integration

**Security**

- SSRF protection — `collectorUrl` must use HTTPS; private IP ranges, loopback, and link-local addresses are rejected
- HTTP header injection guard — CRLF in `apiKey` raises before the Authorization header is set
- Registry response size limit — responses over 512 KB are rejected before parsing
- Remote registry pattern validation — malformed regex patterns in registry responses are rejected with a warning
- ReDoS protection — registry-sourced patterns are validated and rejected if they match known catastrophic backtracking structures

**Testing**

- 97 Vitest tests covering unit, integration, and security behavior across all modules
- Tests run without a live network — all HTTP calls are intercepted via test doubles
- Test suite runnable with `npm test` after `npm ci`

### Compatibility

- Node.js 18+
- Express 4+ / 5+
- Next.js 13.4+ (App Router instrumentation hook)

---

[Unreleased]: https://github.com/cmwright33/apidepth-javascript/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cmwright33/apidepth-javascript/releases/tag/v0.1.0
