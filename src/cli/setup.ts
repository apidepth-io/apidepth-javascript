// CLI setup subcommand — npx apidepth setup
//
// Interactive mode (default):
//   Opens the Apidepth dashboard in a browser so the developer can copy their
//   API key, then prompts for ignored host patterns and writes the initializer.
//
// Non-interactive mode (CI/CD and AI-assisted setup):
//   npx apidepth setup --api-key $APIDEPTH_API_KEY --no-prompt

import { detect } from "./frameworkDetector.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const DASHBOARD_KEYS_URL = "https://apidepth.io/dashboard/api-keys";

interface SetupOptions {
  apiKey?: string | null;
  collectorUrl?: string | null;
  ignoredHosts?: string[];
  noPrompt?: boolean;
  framework?: string | null;
}

export async function runSetup(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  let { apiKey, collectorUrl, noPrompt, framework } = options;
  let ignoredHosts: string[] = options.ignoredHosts ?? [];

  const rl = noPrompt
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      if (!rl) return resolve("");
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });

  try {
    // Interactive: open dashboard and prompt for key
    if (!apiKey && !noPrompt) {
      process.stdout.write("\nApidepth SDK Setup\n");
      process.stdout.write("─".repeat(40) + "\n");
      process.stdout.write("\nOpening your API keys page...\n");
      _openBrowser(DASHBOARD_KEYS_URL);
      apiKey = await ask("\nPaste your API key: ");
      if (!apiKey) {
        process.stderr.write("No API key provided. Aborting.\n");
        process.exit(1);
      }
    }

    // Interactive: prompt for ignored hosts
    if (!noPrompt) {
      process.stdout.write("\nDefault ignored hosts (always skipped):\n");
      for (const h of ["localhost", "127.0.0.1", "0.0.0.0", "::1"]) {
        process.stdout.write(`  • ${h}\n`);
      }
      process.stdout.write(`  • ${collectorUrl ? new URL(collectorUrl).hostname : "collector.apidepth.io"}\n`);
      process.stdout.write("\nAny internal API patterns to ignore? (comma-separated, wildcards ok)\n");
      process.stdout.write(
        "  Examples: *.internal, *.local, *.svc.cluster.local, *.railway.internal\n"
      );
      const raw = await ask("> ");
      if (raw) {
        ignoredHosts = [
          ...ignoredHosts,
          ...raw.split(",").map((h) => h.trim()).filter(Boolean),
        ];
      }
    }

    const result = detect({
      directory: process.cwd(),
      apiKey,
      ignoredHosts,
      collectorUrl,
      frameworkOverride: framework,
    });

    if (!noPrompt) {
      process.stdout.write(`\nDetected: ${result.name.charAt(0).toUpperCase() + result.name.slice(1)}\n`);
    }

    if (result.initializerPath && !noPrompt) {
      process.stdout.write(`\nAdd the following to ${result.initializerPath}:\n\n`);
      process.stdout.write(result.initializerSnippet + "\n");
      const answer = await ask(`Write to ${result.initializerPath}? [y/N] `);
      if (answer.toLowerCase() === "y") {
        const fullPath = path.join(process.cwd(), result.initializerPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, result.initializerSnippet);
        process.stdout.write(`Written to ${result.initializerPath}\n`);
      } else {
        process.stdout.write("(Not written — copy the snippet above into your codebase)\n");
      }
    } else {
      process.stdout.write(result.initializerSnippet + "\n");
    }

    if (!noPrompt) {
      process.stdout.write("\nRun `npx apidepth test` to confirm events are reaching the collector.\n");
    }
  } finally {
    rl?.close();
  }
}

function parseArgs(argv: string[]): SetupOptions {
  const options: SetupOptions = {};
  const args = [...argv];
  while (args.length) {
    const flag = args.shift()!;
    switch (flag) {
      case "--api-key":
        options.apiKey = args.shift() ?? null;
        break;
      case "--collector-url":
        options.collectorUrl = args.shift() ?? null;
        break;
      case "--ignored-hosts": {
        const raw = args.shift() ?? "";
        options.ignoredHosts = raw.split(",").map((h) => h.trim()).filter(Boolean);
        break;
      }
      case "--no-prompt":
        options.noPrompt = true;
        break;
      case "--framework":
        options.framework = args.shift() ?? null;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          "Usage: npx apidepth setup [--api-key KEY] [--no-prompt] [--framework NAME] [--ignored-hosts HOSTS]\n"
        );
        process.exit(0);
    }
  }
  return options;
}

function _openBrowser(url: string): void {
  const { platform } = process;
  try {
    const { execSync } = require("node:child_process"); // eslint-disable-line @typescript-eslint/no-require-imports
    if (platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
    else if (platform === "linux") execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    else process.stdout.write(`Visit: ${url}\n`);
  } catch {
    process.stdout.write(`Visit: ${url}\n`);
  }
}
