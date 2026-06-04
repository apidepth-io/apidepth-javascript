import { getLogger, sanitizeLog } from "./logger.js";

export interface RegistryJson {
  version?: string;
  vendors?: Record<
    string,
    {
      hosts?: string[];
      patterns?: Array<{ match: string; replace: string }>;
    }
  >;
  customer_vendors?: Record<string, string>;
  warnings?: { stale_vendors?: string[] };
}

type CompiledPattern = [RegExp, string];

// Blocks constructs that can cause code-execution or catastrophic backtracking.
// Canonical test cases live in apidepth-collector/tests/fixtures — all SDKs must pass them.
const UNSAFE_RE = /\(\?[{<!=]|\(\?#|\+\?|\*\?\?/;

// Generic fallbacks applied after vendor-specific patterns. Canonical across
// all SDKs (XSDK-NORM) — see apidepth-collector/tests/fixtures/endpoint_cases.json.
// The :token rule requires at least one digit (?=[a-z0-9]*\d) so 24+ char
// readable slugs are left intact while opaque IDs/tokens — which effectively
// always contain a digit — are collapsed. UUID is case-insensitive.
const GENERIC_PATTERNS: CompiledPattern[] = [
  [/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid"],
  [/\/\d{4,}/g, "/:id"],
  [/\/(?=[a-z0-9]*\d)[a-z0-9]{24,}/gi, "/:token"],
];

// Upper bound on path length we run the generic normalizers against. Realistic
// paths are well under 4 KB; above this we skip normalization because the
// :token lookahead is O(n^2) worst-case on a long digit-free alnum run.
const GENERIC_MAX_PATH = 4096;

export const BUNDLED_BASELINE: RegistryJson = {
  version: "bundled",
  vendors: {
    stripe: {
      hosts: ["api.stripe.com"],
      patterns: [
        { match: "/v1/charges/ch_\\w+", replace: "/v1/charges/:id" },
        { match: "/v1/customers/cus_\\w+", replace: "/v1/customers/:id" },
        { match: "/v1/payment_intents/pi_\\w+", replace: "/v1/payment_intents/:id" },
        { match: "/v1/subscriptions/sub_\\w+", replace: "/v1/subscriptions/:id" },
        { match: "/v1/invoices/in_\\w+", replace: "/v1/invoices/:id" },
        { match: "/v1/refunds/re_\\w+", replace: "/v1/refunds/:id" },
      ],
    },
    openai: {
      hosts: ["api.openai.com"],
      patterns: [
        { match: "/v1/chat/completions", replace: "/v1/chat/completions" },
        { match: "/v1/embeddings", replace: "/v1/embeddings" },
        { match: "/v1/images/generations", replace: "/v1/images/generations" },
        { match: "/v1/files/file-\\w+", replace: "/v1/files/:id" },
      ],
    },
    anthropic: {
      hosts: ["api.anthropic.com"],
      patterns: [{ match: "/v1/messages", replace: "/v1/messages" }],
    },
    twilio: {
      hosts: ["api.twilio.com"],
      patterns: [
        {
          match: "/2010-04-01/Accounts/AC\\w+/Messages/SM\\w+",
          replace: "/Accounts/:id/Messages/:id",
        },
        { match: "/2010-04-01/Accounts/AC\\w+/Messages", replace: "/Accounts/:id/Messages" },
        { match: "/2010-04-01/Accounts/AC\\w+/Calls/CA\\w+", replace: "/Accounts/:id/Calls/:id" },
        { match: "/2010-04-01/Accounts/AC\\w+/Calls", replace: "/Accounts/:id/Calls" },
      ],
    },
    resend: {
      hosts: ["api.resend.com"],
      patterns: [{ match: "/emails/[0-9a-f-]{36}", replace: "/emails/:id" }],
    },
    github: {
      hosts: ["api.github.com"],
      patterns: [
        { match: "/repos/[^/]+/[^/]+/pulls/\\d+", replace: "/repos/:owner/:repo/pulls/:number" },
        { match: "/repos/[^/]+/[^/]+/issues/\\d+", replace: "/repos/:owner/:repo/issues/:number" },
        { match: "/repos/[^/]+/[^/]+", replace: "/repos/:owner/:repo" },
        { match: "/users/[^/]+", replace: "/users/:username" },
      ],
    },
  },
};

// Module-level state. JS is single-threaded; no mutex needed.
let _hosts = new Map<string, string>();
let _patterns = new Map<string, CompiledPattern[]>();
let _version = "bundled";

function buildHosts(registry: RegistryJson): Map<string, string> {
  const m = new Map<string, string>();
  for (const [slug, cfg] of Object.entries(registry.vendors ?? {})) {
    for (const h of cfg.hosts ?? []) m.set(h, slug);
  }
  return m;
}

function buildPatterns(registry: RegistryJson): Map<string, CompiledPattern[]> {
  const m = new Map<string, CompiledPattern[]>();
  for (const [slug, cfg] of Object.entries(registry.vendors ?? {})) {
    const list: CompiledPattern[] = [];
    for (const rule of cfg.patterns ?? []) {
      if (UNSAFE_RE.test(rule.match)) {
        getLogger().warn(
          `[Apidepth] Skipping unsafe pattern for ${sanitizeLog(slug)}: ${rule.match}`
        );
        continue;
      }
      try {
        list.push([new RegExp(rule.match), rule.replace]);
      } catch (e) {
        getLogger().warn(
          `[Apidepth] Skipping invalid pattern for ${sanitizeLog(slug)} ${rule.match}: ${e}`
        );
      }
    }
    m.set(slug, list);
  }
  return m;
}

function applyVendorNormalizers(rules: CompiledPattern[], path: string): string {
  for (const [re, replacement] of rules) {
    if (re.test(path)) return path.replace(re, replacement);
  }
  return path;
}

function applyGenericNormalizers(path: string): string {
  if (path.length > GENERIC_MAX_PATH) return path;
  let p = path;
  for (const [re, replacement] of GENERIC_PATTERNS) p = p.replace(re, replacement);
  return p;
}

export const VendorRegistry = {
  identify(host: string, rawPath: string): [string, string] | null {
    const vendor = _hosts.get(host);
    if (!vendor) return null;
    const path = rawPath.split("?")[0] ?? rawPath;
    const rules = _patterns.get(vendor) ?? [];
    let normalized = applyVendorNormalizers(rules, path);
    normalized = applyGenericNormalizers(normalized);
    return [vendor, normalized];
  },

  loadExtraVendors(extra: Record<string, string> | null | undefined): void {
    if (!extra) return;
    for (const [name, host] of Object.entries(extra)) _hosts.set(String(host), String(name));
  },

  replace(registry: RegistryJson, extra?: Record<string, string>): void {
    const newHosts = buildHosts(registry);
    const newPatterns = buildPatterns(registry);
    if (extra) {
      for (const [name, host] of Object.entries(extra)) newHosts.set(String(host), String(name));
    }
    _hosts = newHosts;
    _patterns = newPatterns;
    _version = String(registry.version ?? "unknown");
    getLogger().debug(
      `[Apidepth] Registry updated — version=${sanitizeLog(_version)} vendors=${new Set(newHosts.values()).size}`
    );
  },

  get version(): string {
    return _version;
  },
  get vendorCount(): number {
    return new Set(_hosts.values()).size;
  },
};

// Seed from bundled baseline at module load.
// buildHosts/buildPatterns are called directly to avoid triggering getLogger() before it's set.
_hosts = buildHosts(BUNDLED_BASELINE);
_patterns = buildPatterns(BUNDLED_BASELINE);
_version = BUNDLED_BASELINE.version ?? "bundled";
