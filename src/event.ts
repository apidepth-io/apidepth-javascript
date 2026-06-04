// Outcome taxonomy is shared across all SDKs (Ruby/Python/JS) and the collector.
// 3xx responses map to "unknown" rather than a dedicated bucket — see JS-007.
export type Outcome = "success" | "client_error" | "server_error" | "timeout" | "unknown";

export interface ApidepthEvent {
  vendor: string;
  endpoint: string;
  method: string;
  status: number | null;
  outcome: Outcome;
  duration_ms: number;
  cold_start: boolean;
  env: string;
  ts: number;
  error_class?: string;
  rl_remaining?: number;
  rl_limit?: number;
  rl_reset_at?: number;
  model_name?: string;
}

const REQUIRED = new Set(["vendor", "endpoint", "method", "outcome", "duration_ms", "ts"]);

export function buildEvent(attrs: ApidepthEvent): ApidepthEvent {
  const missing = [...REQUIRED].filter(
    (k) => !(k in (attrs as unknown as Record<string, unknown>))
  );
  if (missing.length > 0) {
    throw new Error(
      `Apidepth event is missing required fields: ${missing.sort().join(", ")}. ` +
        "This is a bug in the SDK — please open an issue."
    );
  }
  return { ...attrs };
}
