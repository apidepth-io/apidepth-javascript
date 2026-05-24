import { AsyncLocalStorage } from "node:async_hooks";

// Recursion guard: prevents the collector's own HTTPS flush from being
// self-instrumented. Equivalent to Ruby's Thread.current[:apidepth_skip].
// AsyncLocalStorage propagates through all await points in the same async
// context, so async flush callbacks are also skipped automatically.
const _storage = new AsyncLocalStorage<true>();

export function isSkipped(): boolean {
  return _storage.getStore() === true;
}

export function withSkip<T>(fn: () => T): T {
  return _storage.run(true, fn);
}
