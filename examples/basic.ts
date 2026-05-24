// Basic usage example — no framework required.
//
// Run:
//   APIDEPTH_API_KEY=apd_live_... npx tsx examples/basic.ts

import Apidepth from "../src/index.js";

Apidepth.configure({
  apiKey: process.env["APIDEPTH_API_KEY"] ?? "",
  environment: process.env["NODE_ENV"] ?? "development",
});
Apidepth.instrument();

// After instrument(), all outbound requests via http, https, or fetch
// to recognised vendor hosts are automatically captured.

// Example: calling the OpenAI API (requires OPENAI_API_KEY in env)
import https from "node:https";

const body = JSON.stringify({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

const req = https.request(
  {
    hostname: "api.openai.com",
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env["OPENAI_API_KEY"] ?? ""}`,
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => {
      data += chunk;
    });
    res.on("end", () => {
      console.log("Status:", res.statusCode);
      console.log("Collector stats:", Apidepth.Collector.getInstance().stats());
    });
  }
);

req.write(body);
req.end();
