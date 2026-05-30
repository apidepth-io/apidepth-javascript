import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "integrations/express": "src/integrations/express.ts",
    "integrations/nextjs": "src/integrations/nextjs.ts",
    "cli/setup": "src/cli/setup.ts",
    "cli/testCmd": "src/cli/testCmd.ts",
    "cli/frameworkDetector": "src/cli/frameworkDetector.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
});
