import { describe, it, expect } from 'vitest';
import { isSkipped, withSkip } from '../src/skip.js';

describe('skip', () => {
  it('isSkipped returns false outside withSkip', () => {
    expect(isSkipped()).toBe(false);
  });

  it('isSkipped returns true inside withSkip', () => {
    withSkip(() => {
      expect(isSkipped()).toBe(true);
    });
  });

  it('isSkipped returns false after withSkip completes', () => {
    withSkip(() => {});
    expect(isSkipped()).toBe(false);
  });

  it('propagates through awaited microtasks', async () => {
    let inner = false;
    await withSkip(async () => {
      await Promise.resolve();
      inner = isSkipped();
    });
    expect(inner).toBe(true);
    expect(isSkipped()).toBe(false);
  });

  it('returns the fn return value', () => {
    expect(withSkip(() => 42)).toBe(42);
  });
});
