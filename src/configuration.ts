export type FlushErrorCallback = (
  err: Error,
  ctx: { droppedEvents: number; consecutiveFailures: number; totalDropped: number }
) => void;

export class Configuration {
  apiKey: string | null = null;
  collectorUrl: string | null = null;
  enabled = true;
  flushInterval = 20;
  registryRefreshInterval = 6 * 60 * 60;
  registryCachePath = "/tmp/apidepth_registry.json";
  ignoredHosts: string[] = [];
  onFlushError: FlushErrorCallback | null = null;
  environment: string | null = null;
  sampleRate = 1.0;
  extraVendors: Record<string, string> = {};
}

let _config: Configuration | null = null;

export function getConfiguration(): Configuration {
  if (!_config) _config = new Configuration();
  return _config;
}

export function resetConfiguration(): void {
  _config = null;
}
