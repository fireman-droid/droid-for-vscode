import { EventEmitter } from 'node:events';
import type { DaemonSessionController } from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';
import { RetainedDaemonSession } from './sessionHandle';

function fixture() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const loading = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const controller = Object.assign(new EventEmitter(), {
    ensureSessionLoaded: vi.fn(() => loading),
    addUserMessage: vi.fn(),
    interruptSession: vi.fn(),
    closeSession: vi.fn(),
  });
  const handle = new RetainedDaemonSession(
    controller as unknown as DaemonSessionController, 'same-session', {}, vi.fn(),
  );
  return { controller, handle, resolve, reject };
}

describe('retained session worker restoration', () => {
  it('cancels only the caller wait while another caller finishes the same SDK load', async () => {
    const value = fixture();
    const cancellation = new AbortController();
    const cancelled = value.handle.ensureLoaded(cancellation.signal);
    const other = value.handle.ensureLoaded();
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    cancellation.abort();
    await rejected;
    value.resolve();
    await expect(other).resolves.toBeUndefined();
    expect(value.controller.ensureSessionLoaded.mock.calls).toEqual([['same-session'], ['same-session']]);
    expect(value.controller.addUserMessage).not.toHaveBeenCalled();
    expect(value.controller.interruptSession).not.toHaveBeenCalled();
    expect(value.controller.closeSession).not.toHaveBeenCalled();
  });

  it('does not revive a session for an already cancelled caller', async () => {
    const value = fixture();
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(value.handle.ensureLoaded(cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(value.controller.ensureSessionLoaded).not.toHaveBeenCalled();
  });

  it('rejects readiness if the handle detached while its worker was loading', async () => {
    const value = fixture();
    const pending = value.handle.ensureLoaded();
    const rejected = expect(pending).rejects.toThrow('Session handle is detached');
    await value.handle.detach();
    value.resolve();
    await rejected;
    expect(value.controller.addUserMessage).not.toHaveBeenCalled();
  });

  it('reports a failed load without issuing a prompt or interrupt', async () => {
    const value = fixture();
    const pending = value.handle.ensureLoaded();
    const rejected = expect(pending).rejects.toThrow('The original daemon is unavailable');
    value.reject(new Error('The original daemon is unavailable'));
    await rejected;
    expect(value.controller.addUserMessage).not.toHaveBeenCalled();
    expect(value.controller.interruptSession).not.toHaveBeenCalled();
  });
});
