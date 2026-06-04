// Extracts the AI model name from vendor JSON response bodies.
//
// Only activates for a hard-coded set of AI vendor hostnames and only when
// Content-Type is application/json. All other calls return null immediately.
//
// node:http path: body is collected passively via a res.push spy (see
// instrumentation.ts) without consuming it — the application receives all the
// same chunks via its own registered listeners.
//
// fetch path: response.clone().text() reads without consuming the original
// response that the caller receives.
//
// Extraction strategy (JS-003): scan for the JSON `"model": "<value>"` field
// with a linear regex rather than JSON.parse-ing a truncated body. Embeddings
// and batch responses place `model` AFTER a large `data` array, so the old
// parse-after-8KB-truncate approach produced invalid JSON and silently dropped
// the model. The regex finds the first structural model field wherever it sits.

const AI_VENDOR_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.cohere.com",
]);

// Upper bound on how far into the body we scan for the model field. 256 KB
// comfortably covers realistic embeddings/batch responses (a few-input OpenAI
// embeddings body is ~23 KB) while bounding work on pathologically large bodies.
export const MODEL_SCAN_MAX_BYTES = 262_144;

// Matches a structural JSON "model": "<value>" pair. Escaped quotes inside
// string values appear as \" so this never matches a "model" mentioned inside
// another JSON string. First match wins (the top-level model field).
const MODEL_RE = /"model"\s*:\s*"([^"]+)"/;

export function isAiVendorHost(host: string): boolean {
  return AI_VENDOR_HOSTS.has(host);
}

export function extractModelNameFromBody(body: string): string | null {
  const slice = body.length > MODEL_SCAN_MAX_BYTES ? body.slice(0, MODEL_SCAN_MAX_BYTES) : body;
  const m = MODEL_RE.exec(slice);
  return m ? m[1] : null;
}
