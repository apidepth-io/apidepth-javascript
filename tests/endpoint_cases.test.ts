/**
 * Endpoint-normalization parity tests driven by the shared golden fixture (XSDK-NORM).
 *
 * Fixture lives in apidepth-collector/tests/fixtures/endpoint_cases.json and is
 * the single source of truth every SDK's VendorRegistry.identify must agree with,
 * so the same host+path normalizes to the same endpoint regardless of language.
 *
 * Resolution mirrors tests/ssrf.test.ts: sibling checkout locally, repo-root
 * checkout in CI. Skips gracefully if the fixture is absent.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VendorRegistry, BUNDLED_BASELINE } from "../src/vendor_registry.js";

interface Case {
  host: string;
  path: string;
  expected: string;
  label: string;
}
interface Fixture {
  cases: Case[];
}

const CANDIDATE_PATHS = [
  fileURLToPath(
    new URL("../../apidepth-collector/tests/fixtures/endpoint_cases.json", import.meta.url)
  ),
  fileURLToPath(
    new URL("../apidepth-collector/tests/fixtures/endpoint_cases.json", import.meta.url)
  ),
];

const fixturePath = CANDIDATE_PATHS.find((p) => existsSync(p));
const fixture: Fixture | null = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture)
  : null;

describe.skipIf(!fixture)(
  "endpoint normalization — shared endpoint_cases fixture (XSDK-NORM)",
  () => {
    beforeEach(() => VendorRegistry.replace(BUNDLED_BASELINE));

    for (const c of fixture?.cases ?? []) {
      it(`${c.label}: ${c.host}${c.path}`, () => {
        const result = VendorRegistry.identify(c.host, c.path);
        expect(result).not.toBeNull();
        expect(result?.[1]).toBe(c.expected);
      });
    }
  }
);
