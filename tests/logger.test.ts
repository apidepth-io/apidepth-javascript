import { describe, it, expect } from 'vitest';
import { sanitizeLog } from '../src/logger.js';

describe('sanitizeLog', () => {
  it('replaces \\n with a space', () => {
    expect(sanitizeLog('line1\nline2')).toBe('line1 line2');
  });

  it('replaces \\r with a space', () => {
    expect(sanitizeLog('line1\rline2')).toBe('line1 line2');
  });

  it('replaces \\t with a space', () => {
    expect(sanitizeLog('col1\tcol2')).toBe('col1 col2');
  });

  it('truncates at 200 characters', () => {
    const long = 'a'.repeat(250);
    const result = sanitizeLog(long);
    expect(result).toHaveLength(200);
  });

  it('converts non-string input via String()', () => {
    expect(sanitizeLog(42)).toBe('42');
    expect(sanitizeLog(null)).toBe('null');
    expect(sanitizeLog(new Error('boom'))).toMatch(/Error.*boom/);
  });
});
