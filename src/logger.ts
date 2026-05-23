export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(msg, ...args),
  warn:  (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
};

let _logger: Logger = defaultLogger;

export function getLogger(): Logger {
  return _logger;
}

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function sanitizeLog(s: unknown): string {
  return String(s).replace(/[\r\n\t]/g, ' ').slice(0, 200);
}
