import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/observability/logger';

const capture = () => {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, write: (line: string) => void lines.push(JSON.parse(line)) };
};

describe('createLogger', () => {
  it('writes one JSON object per entry with the event name and fields', () => {
    const { lines, write } = capture();

    createLogger({}, write).info('checkout.hold.placed', { seatCount: 2 });

    expect(lines).toEqual([
      { time: expect.any(String), level: 'info', event: 'checkout.hold.placed', seatCount: 2 },
    ]);
  });

  it('repeats child bindings such as the correlation id on every line', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'functions' }, write).child({ checkoutId: 'c1', correlationId: 'k1' });

    log.info('a');
    log.warn('b');

    expect(lines.every((line) => line.correlationId === 'k1' && line.checkoutId === 'c1')).toBe(true);
    expect(lines.map((line) => line.service)).toEqual(['functions', 'functions']);
  });

  it('serialises errors, including their cause', () => {
    const { lines, write } = capture();

    createLogger({}, write).error('payment.failed', { err: new Error('outer', { cause: new Error('inner') }) });

    expect(lines[0].err).toMatchObject({ name: 'Error', message: 'outer', cause: { message: 'inner' } });
  });
});
