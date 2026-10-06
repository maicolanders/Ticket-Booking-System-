/*
 * Structured logging: one JSON object per line on stdout, so any host (Express,
 * Azure Functions, a container) ships it as-is and an operator can filter with jq.
 * `event` is a stable dotted name (e.g. "checkout.payment.charged"); context such as
 * checkoutId and correlationId is bound once with child() and repeated on every line.
 */

export type LogFields = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const serialize = (value: unknown): unknown =>
  value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack, cause: serialize(value.cause) }
    : value;

export function createLogger(
  bindings: LogFields = {},
  write: (line: string) => void = (line) => process.stdout.write(line),
): Logger {
  const emit = (level: Level, event: string, fields: LogFields = {}) => {
    const entry: LogFields = { time: new Date().toISOString(), level, event, ...bindings };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
    write(`${JSON.stringify(entry)}\n`);
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (more) => createLogger({ ...bindings, ...more }, write),
  };
}

export const logger = createLogger();
