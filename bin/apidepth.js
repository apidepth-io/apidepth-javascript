#!/usr/bin/env node
// bin/apidepth.js — CLI entry point for the Apidepth JavaScript SDK.
//
// Subcommands:
//   setup   Configure the SDK for your project (writes initializer)
//   test    Send a synthetic test event and confirm the pipeline works

import { runSetup } from "../dist/cli/setup.js";
import { runTest } from "../dist/cli/testCmd.js";

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "setup":
    await runSetup(rest);
    break;
  case "test":
    await runTest(rest);
    break;
  case undefined:
  case "--help":
  case "-h":
    process.stdout.write("Usage: npx apidepth <subcommand> [options]\n\n");
    process.stdout.write("Subcommands:\n");
    process.stdout.write("  setup   Configure the SDK and write your initializer\n");
    process.stdout.write("  test    Send a test event to confirm the pipeline works\n\n");
    process.stdout.write("Run `npx apidepth <subcommand> --help` for subcommand options.\n");
    break;
  default:
    process.stderr.write(`Unknown subcommand: ${JSON.stringify(subcommand)}\n`);
    process.stderr.write("Run `npx apidepth --help` for usage.\n");
    process.exit(1);
}
