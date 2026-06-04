import { describe, it, expect } from "vitest";
import {
  isAiVendorHost,
  extractModelNameFromBody,
  MODEL_SCAN_MAX_BYTES,
} from "../src/model_name_extractor.js";

// ---------------------------------------------------------------------------
// isAiVendorHost
// ---------------------------------------------------------------------------

describe("isAiVendorHost", () => {
  it("returns true for OpenAI", () => {
    expect(isAiVendorHost("api.openai.com")).toBe(true);
  });

  it("returns true for Anthropic", () => {
    expect(isAiVendorHost("api.anthropic.com")).toBe(true);
  });

  it("returns true for Gemini", () => {
    expect(isAiVendorHost("generativelanguage.googleapis.com")).toBe(true);
  });

  it("returns true for Mistral", () => {
    expect(isAiVendorHost("api.mistral.ai")).toBe(true);
  });

  it("returns true for Cohere", () => {
    expect(isAiVendorHost("api.cohere.com")).toBe(true);
  });

  it("returns false for Stripe", () => {
    expect(isAiVendorHost("api.stripe.com")).toBe(false);
  });

  it("returns false for GitHub", () => {
    expect(isAiVendorHost("api.github.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAiVendorHost("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractModelNameFromBody — happy path
// ---------------------------------------------------------------------------

describe("extractModelNameFromBody — happy path", () => {
  it("extracts model name from OpenAI chat completion response", () => {
    const body = JSON.stringify({ model: "gpt-4-turbo", choices: [], usage: {} });
    expect(extractModelNameFromBody(body)).toBe("gpt-4-turbo");
  });

  it("extracts model name from Anthropic message response", () => {
    const body = JSON.stringify({
      id: "msg_01",
      type: "message",
      model: "claude-3-opus-20240229",
      content: [],
    });
    expect(extractModelNameFromBody(body)).toBe("claude-3-opus-20240229");
  });

  it("returns model name even when other fields are present", () => {
    const body = JSON.stringify({
      id: "xyz",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [],
    });
    expect(extractModelNameFromBody(body)).toBe("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// extractModelNameFromBody — edge cases
// ---------------------------------------------------------------------------

describe("extractModelNameFromBody — edge cases", () => {
  it("returns null for invalid JSON", () => {
    expect(extractModelNameFromBody("not json at all")).toBeNull();
  });

  it("returns null when model field is absent", () => {
    const body = JSON.stringify({ choices: [], usage: {} });
    expect(extractModelNameFromBody(body)).toBeNull();
  });

  it("returns null when model is a number", () => {
    const body = JSON.stringify({ model: 42, choices: [] });
    expect(extractModelNameFromBody(body)).toBeNull();
  });

  it("returns null when model is null", () => {
    const body = JSON.stringify({ model: null });
    expect(extractModelNameFromBody(body)).toBeNull();
  });

  it("returns null when model is an empty string", () => {
    const body = JSON.stringify({ model: "" });
    expect(extractModelNameFromBody(body)).toBeNull();
  });

  it("returns null for empty string input", () => {
    expect(extractModelNameFromBody("")).toBeNull();
  });

  it("returns null for empty JSON object", () => {
    expect(extractModelNameFromBody("{}")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(extractModelNameFromBody("[1,2,3]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractModelNameFromBody — body truncation
// ---------------------------------------------------------------------------

describe("extractModelNameFromBody — large bodies (JS-003)", () => {
  it("extracts model when the field is near the start", () => {
    const body = JSON.stringify({ model: "gpt-4-turbo", data: "x".repeat(100) });
    expect(extractModelNameFromBody(body)).toBe("gpt-4-turbo");
  });

  it("captures a model field that follows a large data array (embeddings-style, >8KB)", () => {
    // model sits ~20KB in — past the old 8KB parse cap, well within the scan bound
    const body =
      '{"object":"list","data":["' + "x".repeat(20_000) + '"],"model":"text-embedding-3-small"}';
    expect(body.length).toBeGreaterThan(8_192);
    expect(extractModelNameFromBody(body)).toBe("text-embedding-3-small");
  });

  it("returns null when the model field is beyond the scan bound", () => {
    const body = '{"data":["' + "x".repeat(MODEL_SCAN_MAX_BYTES) + '"],"model":"too-far-away"}';
    expect(extractModelNameFromBody(body)).toBeNull();
  });
});
