// Express integration for Apidepth.
//
// Usage:
//   import express from 'express';
//   import { apidepthMiddleware } from 'apidepth/integrations/express';
//
//   const app = express();
//   app.use(apidepthMiddleware({
//     apiKey: process.env.APIDEPTH_API_KEY,
//     environment: 'production',
//   }));

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { configure, instrument, getLogger } from '../index.js';
import type { Configuration } from '../configuration.js';

export type ExpressOptions = Partial<Configuration>;

export function apidepthMiddleware(opts: ExpressOptions = {}): RequestHandler {
  // Configure and instrument once — subsequent calls are no-ops.
  try {
    configure(opts);
    instrument();
  } catch (e) {
    getLogger().warn(`[Apidepth] Failed to initialize: ${String(e)}`);
  }

  // The middleware itself does nothing to inbound requests — outbound HTTP
  // instrumentation is handled by the monkey-patches applied in instrument().
  return function apidepthNoop(_req: Request, _res: Response, next: NextFunction): void {
    next();
  };
}
