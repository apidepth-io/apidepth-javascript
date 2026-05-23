// Next.js integration for Apidepth.
//
// Usage — create (or add to) src/instrumentation.ts in your Next.js app:
//
//   import { register } from 'apidepth/integrations/nextjs';
//
//   export async function register() {
//     await register({
//       apiKey: process.env.APIDEPTH_API_KEY,
//       environment: process.env.NODE_ENV,
//     });
//   }
//
// Next.js calls instrumentation.ts register() once per runtime (Node.js and Edge).
// Apidepth only instruments the Node.js runtime — it skips the Edge runtime
// because edge workers use Web APIs and don't have node:http/https.

import { configure, instrument, getLogger } from '../index.js';
import type { Configuration } from '../configuration.js';

export type NextjsOptions = Partial<Configuration>;

export async function register(opts: NextjsOptions = {}): Promise<void> {
  // Skip edge runtime — no node:http available there.
  if (process.env['NEXT_RUNTIME'] === 'edge') return;

  try {
    configure(opts);
    instrument();
    getLogger().debug('[Apidepth] Instrumentation active (Next.js Node.js runtime)');
  } catch (e) {
    getLogger().warn(`[Apidepth] Failed to initialize: ${String(e)}`);
  }
}
