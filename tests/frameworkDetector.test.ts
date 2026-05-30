import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detect } from "../src/cli/frameworkDetector.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apidepth-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(rel: string): void {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "");
}

function write(rel: string, content: string): void {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("frameworkDetector", () => {
  it("detects Next.js from next.config.js", () => {
    touch("next.config.js");
    const result = detect({ directory: tmpDir });
    expect(result.name).toBe("nextjs");
    expect(result.initializerPath).toBe("instrumentation.ts");
  });

  it("detects Next.js from next.config.ts", () => {
    touch("next.config.ts");
    const result = detect({ directory: tmpDir });
    expect(result.name).toBe("nextjs");
  });

  it("detects Express from package.json dependencies", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4.18.0" } }));
    const result = detect({ directory: tmpDir });
    expect(result.name).toBe("express");
  });

  it("prefers Next.js over Express when both present", () => {
    touch("next.config.js");
    write("package.json", JSON.stringify({ dependencies: { express: "^4.18.0" } }));
    const result = detect({ directory: tmpDir });
    expect(result.name).toBe("nextjs");
  });

  it("falls back to generic when no known files", () => {
    const result = detect({ directory: tmpDir });
    expect(result.name).toBe("generic");
  });

  it("injects the api key into the snippet", () => {
    const result = detect({ directory: tmpDir, apiKey: "apid_live_abc123" });
    expect(result.initializerSnippet).toContain("apid_live_abc123");
  });

  it("injects ignored hosts into the snippet", () => {
    const result = detect({ directory: tmpDir, ignoredHosts: ["*.internal"] });
    expect(result.initializerSnippet).toContain("*.internal");
  });

  it("applies frameworkOverride", () => {
    const result = detect({ directory: tmpDir, frameworkOverride: "express" });
    expect(result.name).toBe("express");
  });

  it("uses YOUR_API_KEY placeholder when no key provided", () => {
    const result = detect({ directory: tmpDir });
    expect(result.initializerSnippet).toContain("YOUR_API_KEY");
  });
});
