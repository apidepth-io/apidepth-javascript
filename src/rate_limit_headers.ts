// Extracts rate-limit quota state from HTTP response headers and normalises
// them into three canonical fields matching the Ruby and Python SDKs exactly.
//
// Header families (checked in priority order per field):
//   OpenAI/Anthropic: x-ratelimit-remaining-requests, x-ratelimit-limit-requests,
//                     x-ratelimit-reset-requests (duration format: "1s", "20ms", "1m30s")
//   GitHub:           x-ratelimit-remaining, x-ratelimit-limit, x-ratelimit-reset (unix ts)
//   IETF draft:       ratelimit-remaining, ratelimit-limit, ratelimit-reset
//   Stripe/fallback:  retry-after (seconds from now)

export interface RateLimitResult {
  rl_remaining?: number;
  rl_limit?: number;
  rl_reset_at?: number;
}

type Headers = Record<string, string | string[] | undefined>;

const REMAINING_HEADERS = [
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining',
  'ratelimit-remaining',
];
const LIMIT_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit',
  'ratelimit-limit',
];
const RESET_HEADERS = [
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset',
  'ratelimit-reset',
  'retry-after',
];

export function extractRateLimitHeaders(headers: Headers, nowMs: number): RateLimitResult | null {
  const remaining = findInteger(headers, REMAINING_HEADERS);
  const limit     = findInteger(headers, LIMIT_HEADERS);
  const resetAt   = findResetMs(headers, RESET_HEADERS, nowMs);

  if (remaining === undefined && limit === undefined && resetAt === undefined) return null;

  const result: RateLimitResult = {};
  if (remaining !== undefined) result.rl_remaining = remaining;
  if (limit     !== undefined) result.rl_limit     = limit;
  if (resetAt   !== undefined) result.rl_reset_at  = resetAt;
  return result;
}

function getHeader(headers: Headers, name: string): string | undefined {
  const val = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
}

function findInteger(headers: Headers, names: string[]): number | undefined {
  for (const name of names) {
    const val = getHeader(headers, name);
    if (val === undefined) continue;
    const n = parseInt(val.trim(), 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  return undefined;
}

function findResetMs(headers: Headers, names: string[], nowMs: number): number | undefined {
  for (const name of names) {
    const val = getHeader(headers, name);
    if (val === undefined) continue;
    const ms = normalizeResetMs(val.trim(), nowMs);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

function normalizeResetMs(str: string, nowMs: number): number | undefined {
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = parseFloat(str);
    // Large integer → Unix timestamp in seconds; small integer → seconds from now
    return n >= 1_000_000_000 ? Math.round(n * 1000) : nowMs + Math.round(n * 1000);
  }
  const dur = parseDurationMs(str);
  return dur !== undefined ? nowMs + dur : undefined;
}

function parseDurationMs(str: string): number | undefined {
  // Handles: "1s" => 1000, "20ms" => 20, "1m30s" => 90000, "2h" => 7200000
  const re = /(\d+(?:\.\d+)?)(h|m(?!s)|s|ms)/g;
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    found = true;
    const val = parseFloat(m[1]);
    switch (m[2]) {
      case 'h':  total += Math.round(val * 3_600_000); break;
      case 'm':  total += Math.round(val * 60_000);    break;
      case 's':  total += Math.round(val * 1_000);     break;
      case 'ms': total += Math.round(val);             break;
    }
  }
  return found && total > 0 ? total : undefined;
}
