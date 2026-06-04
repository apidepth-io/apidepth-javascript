# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.2](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.3.1...apidepth-v0.3.2) (2026-06-04)


### Bug Fixes

* config validation, key-injection guard, http.get coverage, model extraction, normalization ([#37](https://github.com/apidepth-io/apidepth-javascript/issues/37)) ([a0a2797](https://github.com/apidepth-io/apidepth-javascript/commit/a0a2797db894f934854a057f32a8204c611b5356))
* correct OIDC audience to https://registry.npmjs.org ([#33](https://github.com/apidepth-io/apidepth-javascript/issues/33)) ([6c617e3](https://github.com/apidepth-io/apidepth-javascript/commit/6c617e395cbbc80ba23b68733d2ae8978a97248e))
* drop registry-url so OIDC trusted publisher exchange works ([#30](https://github.com/apidepth-io/apidepth-javascript/issues/30)) ([a2b0e4a](https://github.com/apidepth-io/apidepth-javascript/commit/a2b0e4a6ad4bf0a8e6c816b004a4b1835510c915))
* explicitly exchange OIDC token for npm Trusted Publisher auth ([#32](https://github.com/apidepth-io/apidepth-javascript/issues/32)) ([2461150](https://github.com/apidepth-io/apidepth-javascript/commit/246115044d97e061a9e3b24ed53f4840c17a459f))
* let npm handle OIDC exchange natively for Trusted Publisher ([#34](https://github.com/apidepth-io/apidepth-javascript/issues/34)) ([755ad9e](https://github.com/apidepth-io/apidepth-javascript/commit/755ad9e4d1fc354049195e179e4fb56a0fb65aa7))
* observe response body via res.push spy, record on response (JS-001/JS-004) ([#38](https://github.com/apidepth-io/apidepth-javascript/issues/38)) ([ea004b6](https://github.com/apidepth-io/apidepth-javascript/commit/ea004b6621d621cda420887901128f1f64331ba6))
* upgrade to npm 11.x for built-in OIDC Trusted Publisher support ([#36](https://github.com/apidepth-io/apidepth-javascript/issues/36)) ([20bfa73](https://github.com/apidepth-io/apidepth-javascript/commit/20bfa7347f8d88547d2653bb909ddfe1cb961b92))
* use npm login --auth-type=oidc for Trusted Publisher exchange ([#35](https://github.com/apidepth-io/apidepth-javascript/issues/35)) ([ba48d6a](https://github.com/apidepth-io/apidepth-javascript/commit/ba48d6ab89c764b2b080161ad800f39176224bfe))

## [0.3.1](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.3.0...apidepth-v0.3.1) (2026-06-03)

### Bug Fixes

- use OIDC trusted publisher for npm publish ([#28](https://github.com/apidepth-io/apidepth-javascript/issues/28)) ([f82bf1a](https://github.com/apidepth-io/apidepth-javascript/commit/f82bf1ae100244e829a6facff1b8bb86106dbc59))

## [0.3.0](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.2.0...apidepth-v0.3.0) (2026-06-03)

### Features

- add model name extraction from AI vendor response bodies ([#26](https://github.com/apidepth-io/apidepth-javascript/issues/26)) ([ee7fdec](https://github.com/apidepth-io/apidepth-javascript/commit/ee7fdec1f7aeb3cc8cc39f917b9b9bf1207ef2d9))

## [0.2.0](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.1.1...apidepth-v0.2.0) (2026-05-30)

### Features

- onboarding cluster — setup/test CLI, smart ignored host defaults, framework detection ([#8](https://github.com/apidepth-io/apidepth-javascript/issues/8)) ([c3b4823](https://github.com/apidepth-io/apidepth-javascript/commit/c3b482355b451c25ad7244bb4be2f1e25ff4203c))

## [0.1.1](https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.1.0...apidepth-v0.1.1) (2026-05-27)

### Bug Fixes

- gitleaks allowlist for test fixture key, prettier CLAUDE.md and CONTRIBUTING.md ([3e98c64](https://github.com/apidepth-io/apidepth-javascript/commit/3e98c64c40b82d070b264a7da44d71020febb317))

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

- 112 Vitest tests covering unit, integration, and security behavior across all modules
- Tests run without a live network — all HTTP calls are intercepted via test doubles
- Test suite runnable with `npm test` after `npm ci`

### Compatibility

- Node.js 18+
- Express 4+ / 5+
- Next.js 13.4+ (App Router instrumentation hook)

---

[Unreleased]: https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.1.1...HEAD
[0.1.1]: https://github.com/apidepth-io/apidepth-javascript/compare/apidepth-v0.1.0...apidepth-v0.1.1
[0.1.0]: https://github.com/apidepth-io/apidepth-javascript/releases/tag/apidepth-v0.1.0
