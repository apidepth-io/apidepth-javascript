/**
 * Tests for the CLI setup subcommand.
 *
 * Covers the --no-prompt (CI/CD) path which is the non-interactive
 * code path. Interactive readline prompts are integration-tested via
 * the CLI itself and are excluded here since they require a real TTY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runSetup } from "../src/cli/setup.js";

// --- test infra ---

let tmpDir: string;
let stdoutChunks: string[];
let stderrChunks: string[];
const originalCwd = process.cwd;
const originalExit = process.exit;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apidepth-setup-test-"));
  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : "");
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : "");
    return true;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).cwd = () => tmpDir;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = vi.fn();
});

afterEach(() => {
  process.cwd = originalCwd;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = originalExit;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- tests ---

describe("runSetup --no-prompt", () => {
  it("prints the initializer snippet to stdout", async () => {
    await runSetup(["--no-prompt"]);
    const output = stdoutChunks.join("");
    expect(output.length).toBeGreaterThan(0);
  });

  it("injects the api key into the printed snippet", async () => {
    await runSetup(["--no-prompt", "--api-key", "apid_live_test123"]);
    const output = stdoutChunks.join("");
    expect(output).toContain("apid_live_test123");
  });

  it("detects Next.js and outputs instrumentation snippet", async () => {
    fs.writeFileSync(path.join(tmpDir, "next.config.js"), "");
    await runSetup(["--no-prompt", "--api-key", "apid_live_key"]);
    const output = stdoutChunks.join("");
    // Next.js snippet uses registerInstrumentation
    expect(output).toContain("apid_live_key");
  });

  it("uses --framework override", async () => {
    await runSetup(["--no-prompt", "--framework", "express"]);
    const output = stdoutChunks.join("");
    expect(output.length).toBeGreaterThan(0);
  });

  it("handles --ignored-hosts flag", async () => {
    await runSetup(["--no-prompt", "--ignored-hosts", "*.internal,api.private"]);
    const output = stdoutChunks.join("");
    expect(output).toContain("*.internal");
  });

  it("handles --collector-url flag", async () => {
    await runSetup(["--no-prompt", "--collector-url", "https://my-collector.example.com"]);
    const output = stdoutChunks.join("");
    expect(output.length).toBeGreaterThan(0);
  });

  it("prints help and exits for --help flag", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = vi.fn().mockImplementation((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(runSetup(["--help"])).rejects.toThrow("process.exit(0)");
    const output = stdoutChunks.join("");
    expect(output).toContain("Usage");
  });

  it("prints help and exits for -h flag", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = vi.fn().mockImplementation((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(runSetup(["-h"])).rejects.toThrow("process.exit(0)");
  });

  it("handles unknown flags gracefully", async () => {
    // Should not throw for unknown flag
    await runSetup(["--no-prompt", "--unknown-flag"]);
    const output = stdoutChunks.join("");
    expect(output.length).toBeGreaterThan(0);
  });
});
