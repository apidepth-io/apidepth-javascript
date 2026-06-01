// Extracts the AI model name from vendor JSON response bodies.
//
// Only activates for a hard-coded set of AI vendor hostnames and only when
// Content-Type is application/json. All other calls return null immediately.
//
// node:http path: body is collected passively via data/end events on the
// IncomingMessage stream without consuming it — the application receives all
// the same chunks via its own registered listeners.
//
// fetch path: response.clone().text() reads without consuming the original
// response that the caller receives.

const AI_VENDOR_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.cohere.com",
]);

const MAX_BODY_BYTES = 8_192;

export function isAiVendorHost(host: string): boolean {
  return AI_VENDOR_HOSTS.has(host);
}

export function extractModelNameFromBody(body: string): string | null {
  try {
    const data = JSON.parse(body.slice(0, MAX_BODY_BYTES)) as unknown;
    if (
      data !== null &&
      typeof data === "object" &&
      "model" in data &&
      typeof (data as Record<string, unknown>).model === "string"
    ) {
      const model = (data as Record<string, string>).model;
      return model.length > 0 ? model : null;
    }
  } catch {
    // malformed JSON or streaming body — silently ignore
  }
  return null;
}
