import { describe, it, expect } from "vitest";
import { extractRateLimitHeaders } from "../src/rate_limit_headers.js";

const NOW = 1_700_000_000_000;

describe("extractRateLimitHeaders", () => {
  it("returns null when no recognised headers present", () => {
    expect(extractRateLimitHeaders({}, NOW)).toBeNull();
    expect(extractRateLimitHeaders({ "x-custom-header": "1" }, NOW)).toBeNull();
  });

  it("extracts OpenAI-style headers", () => {
    const result = extractRateLimitHeaders(
      {
        "x-ratelimit-remaining-requests": "42",
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-reset-requests": "1s",
      },
      NOW
    );
    expect(result).toEqual({
      rl_remaining: 42,
      rl_limit: 1000,
      rl_reset_at: NOW + 1000,
    });
  });

  it("extracts GitHub-style headers (unix timestamp)", () => {
    const resetTs = 1_716_000_000;
    const result = extractRateLimitHeaders(
      {
        "x-ratelimit-remaining": "59",
        "x-ratelimit-limit": "60",
        "x-ratelimit-reset": String(resetTs),
      },
      NOW
    );
    expect(result?.rl_remaining).toBe(59);
    expect(result?.rl_limit).toBe(60);
    expect(result?.rl_reset_at).toBe(resetTs * 1000);
  });

  it("extracts IETF draft headers", () => {
    const result = extractRateLimitHeaders(
      {
        "ratelimit-remaining": "10",
        "ratelimit-limit": "100",
      },
      NOW
    );
    expect(result).toMatchObject({ rl_remaining: 10, rl_limit: 100 });
  });

  it("handles retry-after as seconds from now", () => {
    const result = extractRateLimitHeaders({ "retry-after": "30" }, NOW);
    expect(result?.rl_reset_at).toBe(NOW + 30_000);
  });

  describe("duration string parsing", () => {
    const cases: [string, number][] = [
      ["1s", 1_000],
      ["20ms", 20],
      ["1m30s", 90_000],
      ["2h", 7_200_000],
      ["1m", 60_000],
    ];
    it.each(cases)('"%s" → %d ms added to nowMs', (input, expected) => {
      const result = extractRateLimitHeaders({ "x-ratelimit-reset-requests": input }, NOW);
      expect(result?.rl_reset_at).toBe(NOW + expected);
    });
  });

  it('handles a zero-duration reset ("0s" means reset already in progress)', () => {
    const result = extractRateLimitHeaders({ "x-ratelimit-reset-requests": "0s" }, NOW);
    expect(result?.rl_reset_at).toBe(NOW);
  });

  it('handles "0ms" as a zero-duration reset', () => {
    const result = extractRateLimitHeaders({ "x-ratelimit-reset-requests": "0ms" }, NOW);
    expect(result?.rl_reset_at).toBe(NOW);
  });

  it("omits fields that are absent", () => {
    const result = extractRateLimitHeaders({ "ratelimit-remaining": "5" }, NOW);
    expect(result).toEqual({ rl_remaining: 5 });
    expect("rl_limit" in result!).toBe(false);
    expect("rl_reset_at" in result!).toBe(false);
  });

  it("handles array-valued headers by using the first element", () => {
    const result = extractRateLimitHeaders({ "x-ratelimit-remaining-requests": ["42", "99"] }, NOW);
    expect(result?.rl_remaining).toBe(42);
  });

  it("skips a header whose value is negative and falls back to the next name", () => {
    // "-1" fails the n >= 0 guard; limit via the second header family still works
    const result = extractRateLimitHeaders(
      { "x-ratelimit-remaining-requests": "-1", "x-ratelimit-limit-requests": "100" },
      NOW
    );
    expect(result?.rl_remaining).toBeUndefined();
    expect(result?.rl_limit).toBe(100);
  });

  it("skips an unparseable reset header and falls back to retry-after", () => {
    // "not-a-reset" is not a number or duration, so normalizeResetMs returns undefined
    // → the false branch of `if (ms !== undefined)` fires, and the loop continues to retry-after
    const result = extractRateLimitHeaders(
      { "x-ratelimit-reset-requests": "not-a-reset", "retry-after": "5" },
      NOW
    );
    expect(result?.rl_reset_at).toBe(NOW + 5_000);
  });
});
