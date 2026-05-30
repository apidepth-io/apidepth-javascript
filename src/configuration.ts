export type FlushErrorCallback = (
  err: Error,
  ctx: { droppedEvents: number; consecutiveFailures: number; totalDropped: number }
) => void;

// Always ignored regardless of user config. Unambiguous loopback addresses only —
// wildcard internal patterns are not pre-populated to avoid silently swallowing
// traffic the developer wants to see. The setup subcommand prompts for extras.
const HARD_IGNORED_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

export class Configuration {
  apiKey: string | null = null;
  enabled = true;
  flushInterval = 20;
  registryRefreshInterval = 6 * 60 * 60;
  registryCachePath = "/tmp/apidepth_registry.json";
  onFlushError: FlushErrorCallback | null = null;
  environment: string | null = null;
  sampleRate = 1.0;
  extraVendors: Record<string, string> = {};

  private _collectorUrl: string | null = null;
  private _userHosts: string[] = [];
  private _exactIgnored: Set<string> = new Set(HARD_IGNORED_HOSTS);
  private _globPatterns: string[] = [];

  get collectorUrl(): string | null {
    return this._collectorUrl;
  }

  set collectorUrl(url: string | null) {
    this._collectorUrl = url;
    this._rebuildIgnoredHosts();
  }

  get ignoredHosts(): string[] {
    return [...this._exactIgnored, ...this._globPatterns];
  }

  set ignoredHosts(hosts: string[]) {
    this._userHosts = hosts ?? [];
    this._rebuildIgnoredHosts();
  }

  /** Returns true if host should be skipped. Supports glob wildcards (* and ?). */
  isIgnoredHost(host: string): boolean {
    if (this._exactIgnored.has(host)) return true;
    return this._globPatterns.some((pat) => _matchGlob(pat, host));
  }

  private _rebuildIgnoredHosts(): void {
    const all = [...HARD_IGNORED_HOSTS, ...this._userHosts];
    if (this._collectorUrl) {
      try {
        const h = new URL(this._collectorUrl).hostname;
        if (h) all.push(h);
      } catch {
        // malformed URL — skip
      }
    }
    this._exactIgnored = new Set(all.filter((p) => !p.includes("*") && !p.includes("?")));
    this._globPatterns = all.filter((p) => p.includes("*") || p.includes("?"));
  }
}

function _matchGlob(pattern: string, host: string): boolean {
  // Escape regex special chars, then convert glob * → .* and ? → .
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return regex.test(host);
}

let _config: Configuration | null = null;

export function getConfiguration(): Configuration {
  if (!_config) _config = new Configuration();
  return _config;
}

export function resetConfiguration(): void {
  _config = null;
}
