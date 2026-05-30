// Framework detection for the apidepth setup subcommand.
//
// Detects the web framework in the current directory by inspecting well-known
// files and package.json dependencies. Returns a DetectedFramework with the
// recommended initializer path and a copy-paste-ready snippet.

import fs from "node:fs";
import path from "node:path";

export interface DetectedFramework {
  name: "rails" | "sinatra" | "django" | "fastapi" | "nextjs" | "express" | "generic";
  initializerPath: string | null;
  initializerSnippet: string;
}

export function detect(options: {
  directory?: string;
  apiKey?: string | null;
  ignoredHosts?: string[];
  collectorUrl?: string | null;
  frameworkOverride?: string | null;
}): DetectedFramework {
  const dir = options.directory ?? process.cwd();
  const framework = options.frameworkOverride ?? _detectFramework(dir);
  return _buildResult(framework, {
    apiKey: options.apiKey ?? null,
    ignoredHosts: options.ignoredHosts ?? [],
    collectorUrl: options.collectorUrl ?? null,
  });
}

function _detectFramework(dir: string): string {
  const exists = (...parts: string[]) => fs.existsSync(path.join(dir, ...parts));

  // Next.js takes priority over Express (Next projects also have express-like package.json)
  if (exists("next.config.js") || exists("next.config.ts")) return "nextjs";

  if (exists("package.json") && _hasNpmDep(dir, "express")) return "express";

  return "generic";
}

function _hasNpmDep(dir: string, pkg: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const deps = {
      ...(data.dependencies as Record<string, string> | undefined),
      ...(data.devDependencies as Record<string, string> | undefined),
    };
    return pkg in deps;
  } catch {
    return false;
  }
}

function _buildResult(
  framework: string,
  { apiKey, ignoredHosts, collectorUrl }: { apiKey: string | null; ignoredHosts: string[]; collectorUrl: string | null }
): DetectedFramework {
  const keyVal = apiKey ? JSON.stringify(apiKey) : '"YOUR_API_KEY"';
  const urlVal = collectorUrl ? JSON.stringify(collectorUrl) : '"https://collector.apidepth.io"';
  const hostsVal = JSON.stringify(ignoredHosts);

  switch (framework) {
    case "nextjs":
      return {
        name: "nextjs",
        initializerPath: "instrumentation.ts",
        initializerSnippet: `\
// instrumentation.ts (Next.js 13.4+)
import apidepth from "apidepth";

export async function register() {
  apidepth.configure({
    apiKey: ${keyVal},
    collectorUrl: ${urlVal},
    ignoredHosts: ${hostsVal},
  });
  apidepth.instrument();
}
`,
      };

    case "express":
      return {
        name: "express",
        initializerPath: null,
        initializerSnippet: `\
// Near the top of your main app file, before any routes
import apidepth from "apidepth";

apidepth.configure({
  apiKey: ${keyVal},
  collectorUrl: ${urlVal},
  ignoredHosts: ${hostsVal},
});
apidepth.instrument();
`,
      };

    default:
      return {
        name: "generic",
        initializerPath: null,
        initializerSnippet: `\
import apidepth from "apidepth";

apidepth.configure({
  apiKey: ${keyVal},
  collectorUrl: ${urlVal},
  ignoredHosts: ${hostsVal},
});
apidepth.instrument();
`,
      };
  }
}
