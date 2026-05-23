import { describe, it, expect } from 'vitest';
import { buildEvent, type ApidepthEvent } from '../src/event.js';

const VALID: ApidepthEvent = {
  vendor:      'stripe',
  endpoint:    '/v1/charges',
  method:      'POST',
  status:      200,
  outcome:     'success',
  duration_ms: 120,
  cold_start:  false,
  env:         'production',
  ts:          1700000000000,
};

describe('buildEvent', () => {
  it('returns a copy of a valid event', () => {
    const result = buildEvent(VALID);
    expect(result).toEqual(VALID);
    expect(result).not.toBe(VALID);
  });

  it('includes optional fields when present', () => {
    const result = buildEvent({ ...VALID, rl_remaining: 42, rl_limit: 100, rl_reset_at: 1700000060000 });
    expect(result.rl_remaining).toBe(42);
    expect(result.rl_limit).toBe(100);
    expect(result.rl_reset_at).toBe(1700000060000);
  });

  it('throws when a required field is missing', () => {
    const { vendor: _v, ...withoutVendor } = VALID;
    expect(() => buildEvent(withoutVendor as ApidepthEvent)).toThrow(/missing required fields.*vendor/i);
  });

  it('lists all missing fields sorted in the error message', () => {
    const { vendor: _v, endpoint: _e, method: _m, ...partial } = VALID;
    expect(() => buildEvent(partial as ApidepthEvent)).toThrow(/endpoint.*method.*vendor/);
  });
});
