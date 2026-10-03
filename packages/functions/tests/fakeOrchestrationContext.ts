import type { OrchestrationContext } from 'durable-functions';
import type { CheckoutStatus } from '@ticket/shared';
import { checkoutOrchestrator } from '../src/orchestrators/checkoutOrchestrator';
import type { CheckoutRef } from '../src/contracts';

/*
 * Drives the orchestrator generator the way the Durable runtime does, with a
 * script answering each activity. An activity answer that throws simulates
 * "retries exhausted". `first` decides which awaited task wins Task.any.
 */

type Answer = (input: Record<string, unknown>) => unknown;

export interface Script {
  activities: Record<string, Answer>;
  first?: 'timer' | 'payment' | 'cancel';
  paymentToken?: string;
}

interface FakeTask {
  kind: 'activity' | 'timer' | 'event' | 'any';
  name?: string;
  input?: Record<string, unknown>;
  tasks?: FakeTask[];
  result?: unknown;
  cancelled?: boolean;
  cancel?: () => void;
}

export const ref: CheckoutRef = { checkoutId: 'checkout-1', correlationId: 'correlation-1' };

export function runOrchestrator(script: Script) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const statuses: unknown[] = [];
  const timers: FakeTask[] = [];

  const context = {
    df: {
      instanceId: ref.checkoutId,
      isReplaying: true, // keep test output quiet; logging is not under test
      currentUtcDateTime: new Date('2030-01-01T00:00:00Z'),
      getInput: () => ref,
      setCustomStatus: (status: unknown) => void statuses.push(status),
      callActivityWithRetry: (name: string, _retry: unknown, input: Record<string, unknown>): FakeTask => ({
        kind: 'activity',
        name,
        input,
      }),
      createTimer: (): FakeTask => {
        const timer: FakeTask = { kind: 'timer', cancelled: false };
        timer.cancel = () => (timer.cancelled = true);
        timers.push(timer);
        return timer;
      },
      waitForExternalEvent: (name: string): FakeTask => ({ kind: 'event', name }),
      Task: { any: (tasks: FakeTask[]): FakeTask => ({ kind: 'any', tasks }) },
    },
  } as unknown as OrchestrationContext;

  const generator = checkoutOrchestrator(context);
  let step = generator.next();
  while (!step.done) {
    const task = step.value as unknown as FakeTask;
    if (task.kind === 'any') {
      const [timer, payment, cancel] = task.tasks!;
      payment.result = { paymentToken: script.paymentToken ?? 'tok_ok' };
      const winner = { timer, payment, cancel }[script.first ?? 'payment'];
      step = generator.next(winner as never);
      continue;
    }
    if (task.kind === 'timer') {
      step = generator.next();
      continue;
    }
    calls.push({ name: task.name!, input: task.input! });
    const answer = script.activities[task.name!];
    if (!answer) throw new Error(`Unscripted activity ${task.name}`);
    let result: unknown;
    try {
      result = answer(task.input!);
    } catch (error) {
      step = generator.throw(error);
      continue;
    }
    step = generator.next(result as never);
  }
  return { status: step.value as CheckoutStatus, calls, names: calls.map((c) => c.name), statuses, timers };
}

export const exhausted = (): never => {
  throw new Error('activity failed after all retries');
};
