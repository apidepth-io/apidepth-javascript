// CLI test subcommand — npx apidepth test
//
// Fires a synthetic test event to the collector and confirms the pipeline works.
// Hard 5-second timeout. Per-failure-mode messages with concrete next steps.

import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const DEFAULT_COLLECTOR_URL = "https://collector.apidepth.io";
const TIMEOUT_MS = 5_000;

let sdkVersion = "unknown";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ VERSION: sdkVersion } = require("../version.js"));
} catch {
  // ignore — version is cosmetic in the test payload
}

export async function runTest(_argv: string[]): Promise<void> {
  const { apiKey, collectorUrl } = _loadConfig();

  if (!apiKey) {
    process.stderr.write("No API key configured.\n");
    process.stderr.write("Run `npx apidepth setup` or set APIDEPTH_API_KEY.\n");
    process.exit(1);
  }

  const base = (collectorUrl ?? DEFAULT_COLLECTOR_URL).replace(/\/$/, "");
  process.stdout.write("Sending test event to collector... ");

  try {
    const elapsed = await _sendTestEvent(apiKey, base);
    process.stdout.write(`✓ received in ${elapsed}ms\n`);
    process.stdout.write("Visit your dashboard: https://apidepth.io/dashboard\n");
  } catch (err) {
    process.stdout.write("✗\n");
    if (err instanceof TestError) {
      process.stderr.write(`\n${err.message}\n`);
      if (err.hint) process.stderr.write(`${err.hint}\n`);
    } else {
      process.stderr.write(`\nUnexpected error: ${err}\n`);
    }
    process.exit(1);
  }
}

class TestError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message);
  }
}

function _loadConfig(): { apiKey: string | null; collectorUrl: string | null } {
  try {
    const { getConfiguration } = require("../configuration.js"); // eslint-disable-line @typescript-eslint/no-require-imports
    const cfg = getConfiguration();
    return {
      apiKey: cfg.apiKey ?? process.env.APIDEPTH_API_KEY ?? null,
      collectorUrl: cfg.collectorUrl ?? process.env.APIDEPTH_COLLECTOR_URL ?? null,
    };
  } catch {
    return {
      apiKey: process.env.APIDEPTH_API_KEY ?? null,
      collectorUrl: process.env.APIDEPTH_COLLECTOR_URL ?? null,
    };
  }
}

function _sendTestEvent(apiKey: string, baseUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(`${baseUrl}/v1/events`);
    const payload = JSON.stringify({
      batch: [
        {
          vendor: "apidepth-test",
          endpoint: "/test",
          method: "GET",
          status: 200,
          outcome: "success",
          duration_ms: 1,
          cold_start: false,
          env: "test",
          ts: Date.now(),
          test: true,
        },
      ],
      sdk: { name: "apidepth-javascript", version: sdkVersion },
    });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : undefined,
      path: parsedUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const start = Date.now();

    const req = transport.request(options, (res) => {
      const status = res.statusCode ?? 0;
      // drain response body
      res.resume();
      res.on("end", () => {
        if (status === 200 || status === 201 || status === 204) {
          resolve(Date.now() - start);
        } else if (status === 401 || status === 403) {
          reject(
            new TestError(
              `API key not recognised (HTTP ${status}).`,
              "Check the key in your initializer matches your dashboard at https://apidepth.io/dashboard/api-keys"
            )
          );
        } else {
          reject(
            new TestError(
              `Collector returned HTTP ${status}.`,
              "Check https://status.apidepth.io for service status."
            )
          );
        }
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(
        new TestError(
          `No response after ${TIMEOUT_MS / 1000} seconds.`,
          "Check for a firewall blocking outbound port 443."
        )
      );
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      const msg = err.message.toLowerCase();
      if (msg.includes("ssl") || msg.includes("cert")) {
        reject(
          new TestError(
            `SSL certificate verification failed: ${err.message}`,
            "Check your Node.js SSL configuration."
          )
        );
      } else if (err.code === "ECONNREFUSED" || msg.includes("getaddrinfo")) {
        reject(
          new TestError(
            `Could not reach collector: ${err.message}`,
            "Check outbound HTTPS (port 443) is allowed from this environment."
          )
        );
      } else {
        reject(new TestError(`Connection error: ${err.message}`));
      }
    });

    req.write(payload);
    req.end();
  });
}
