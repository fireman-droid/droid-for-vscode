import { describe, expect, it } from 'vitest';

import type {
  FactoryDroidSession,
  FactoryDroidSessionFactory,
} from '../FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from '../runtimeInteractions';
import { createDaemonFirstSessionFactory } from './daemonFirstSessionFactory';

function fakeSession(id: string): FactoryDroidSession {
  return { id } as unknown as FactoryDroidSession;
}

function countingFactory(id: string): {
  factory: FactoryDroidSessionFactory;
  calls: () => number;
} {
  let calls = 0;
  return {
    factory: async () => {
      calls += 1;
      return fakeSession(id);
    },
    calls: () => calls,
  };
}

const sessionOptions = {
  target: { kind: 'new', cwd: 'C:/workspace' } as const,
  interactionHandler: cancellingRuntimeInteractionHandler,
};

describe('createDaemonFirstSessionFactory', () => {
  it('uses the daemon factory while the daemon is acquirable', async () => {
    const daemon = countingFactory('daemon-session');
    const process = countingFactory('process-session');
    const fallbacks: unknown[] = [];
    const wrapped = createDaemonFirstSessionFactory({
      acquireDaemon: async () => ({}),
      daemonFactory: daemon.factory,
      processFactory: process.factory,
      onFallback: (error) => fallbacks.push(error),
    });

    const session = await wrapped.factory(sessionOptions);
    expect(session.id).toBe('daemon-session');
    expect(daemon.calls()).toBe(1);
    expect(process.calls()).toBe(0);
    expect(wrapped.didFallBack()).toBe(false);
    expect(fallbacks).toEqual([]);
  });

  it('falls back to process sessions when acquisition fails, stickily', async () => {
    const daemon = countingFactory('daemon-session');
    const process = countingFactory('process-session');
    const fallbacks: unknown[] = [];
    let acquisitions = 0;
    const wrapped = createDaemonFirstSessionFactory({
      acquireDaemon: async () => {
        acquisitions += 1;
        throw new Error('daemon spawn failed');
      },
      daemonFactory: daemon.factory,
      processFactory: process.factory,
      onFallback: (error) => fallbacks.push(error),
    });

    const first = await wrapped.factory(sessionOptions);
    expect(first.id).toBe('process-session');
    expect(wrapped.didFallBack()).toBe(true);
    expect(fallbacks).toHaveLength(1);
    expect(String(fallbacks[0])).toContain('daemon spawn failed');

    // Sticky: no re-acquisition attempt, still process, no second
    // fallback event.
    const second = await wrapped.factory(sessionOptions);
    expect(second.id).toBe('process-session');
    expect(acquisitions).toBe(1);
    expect(fallbacks).toHaveLength(1);
    expect(daemon.calls()).toBe(0);
    expect(process.calls()).toBe(2);
  });

  it('propagates session-level daemon errors without falling back', async () => {
    const process = countingFactory('process-session');
    const fallbacks: unknown[] = [];
    const wrapped = createDaemonFirstSessionFactory({
      acquireDaemon: async () => ({}),
      daemonFactory: async () => {
        throw new Error('Session is open in another window (pid 4242).');
      },
      processFactory: process.factory,
      onFallback: (error) => fallbacks.push(error),
    });

    await expect(wrapped.factory(sessionOptions)).rejects.toThrow(
      'open in another window',
    );
    expect(wrapped.didFallBack()).toBe(false);
    expect(fallbacks).toEqual([]);
    expect(process.calls()).toBe(0);
  });

  it('keeps working when the fallback observer throws', async () => {
    const process = countingFactory('process-session');
    const wrapped = createDaemonFirstSessionFactory({
      acquireDaemon: async () => {
        throw new Error('daemon spawn failed');
      },
      daemonFactory: countingFactory('daemon-session').factory,
      processFactory: process.factory,
      onFallback: () => {
        throw new Error('sink broken');
      },
    });

    const session = await wrapped.factory(sessionOptions);
    expect(session.id).toBe('process-session');
    expect(wrapped.didFallBack()).toBe(true);
  });
});
