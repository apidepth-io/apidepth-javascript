/**
 * SSRF guard parity tests driven by the canonical shared fixture (JS-011).
 *
 * Fixture lives in apidepth-collector/tests/fixtures/private_host_cases.json and
 * is the single source of truth every SDK's collector-URL validator must agree
 * with. The Ruby spec and Python test_ssrf.py already load it; this brings the
 * JS SDK to parity so validateCollectorUrl can't silently drift.
 *
 * Resolution: locally the collector repo is a sibling of this one; in CI it is
 * checked out at the repo root (see .github/workflows/ci.yml). If neither path
 * exists the suite skips rather than failing, so a missing checkout never reds
 * the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateCollectorUrl } from "../src/collector.js";

interface Case {
  host: string;
  label: string;
}
interface Fixture {
  must_block: Case[];
  must_allow: Case[];
}

const CANDIDATE_PATHS = [
  // Local dev: collector checked out as a sibling of this repo.
  fileURLToPath(
    new URL("../../apidepth-collector/tests/fixtures/private_host_cases.json", import.meta.url)
  ),
  // CI: collector sparse-checked-out at this repo's root.
  fileURLToPath(
    new URL("../apidepth-collector/tests/fixtures/private_host_cases.json", import.meta.url)
  ),
];

const fixturePath = CANDIDATE_PATHS.find((p) => existsSync(p));
const fixture: Fixture | null = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture)
  : null;

// Run a host through the exact path the SDK uses: new URL(...) — which itself
// rejects some malformed hosts (e.g. unbracketed IPv6) — then the validator.
// Either rejection counts as "blocked".
function check(host: string): void {
  const url = new URL(`https://${host}/v1/events`);
  validateCollectorUrl(url);
}

describe.skipIf(!fixture)("SSRF guard — shared private_host_cases fixture (JS-011)", () => {
  describe("must_block", () => {
    for (const c of fixture?.must_block ?? []) {
      it(`blocks ${c.label} (${c.host})`, () => {
        expect(() => check(c.host)).toThrow();
      });
    }
  });

  describe("must_allow", () => {
    for (const c of fixture?.must_allow ?? []) {
      it(`allows ${c.label} (${c.host})`, () => {
        expect(() => check(c.host)).not.toThrow();
      });
    }
  });
});
