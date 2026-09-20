import { describe, expect, it, vi } from 'vitest';
import type { DaemonSessionHandle } from './api';
import { bindSessionIde } from './ideSessionHandle';

function fixture() {
  const stream = vi.fn(async function* () {
    yield { type: 'assistant', text: 'ready' };
  });
  const interrupt = vi.fn(async () => {});
  const detach = vi.fn(async () => {});
  const ensureLoaded = vi.fn(async () => {});
  const handle = { id: 'chat', stream, interrupt, detach, ensureLoaded } as unknown as DaemonSessionHandle;
  let release!: () => void;
  const wait = vi.fn((signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    release = resolve;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  return { handle: bindSessionIde(handle, wait), stream, interrupt, detach, ensureLoaded, wait, release: () => release() };
}

describe('native IDE turn admission', () => {
  it('does not submit the first prompt before its own IDE connection is ready', async () => {
    const first = fixture();
    const other = fixture();
    const firstResult = first.handle.stream('first', { includePartialMessages: true }).next();
    const otherResult = other.handle.stream('other').next();

    expect(first.stream).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(other.wait).toHaveBeenCalledOnce());
    other.release();
    await otherResult;
    expect(other.stream).toHaveBeenCalledOnce();
    expect(first.stream).not.toHaveBeenCalled();

    first.release();
    expect(await firstResult).toMatchObject({ value: { text: 'ready' } });
    expect(first.stream).toHaveBeenCalledWith('first', { includePartialMessages: true });
    expect(other.stream).toHaveBeenCalledWith('other', { includePartialMessages: false });
  });

  it('interrupts a readiness wait without subsequently submitting the prompt', async () => {
    const value = fixture();
    const result = value.handle.stream('must not send').next();
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(value.wait).toHaveBeenCalledOnce());
    await value.handle.interrupt();
    await rejected;
    value.release();
    expect(value.interrupt).toHaveBeenCalledOnce();
    expect(value.stream).not.toHaveBeenCalled();
  });

  it('cancels an unsubmitted prompt when its handle is detached', async () => {
    const value = fixture();
    const result = value.handle.stream('must not survive detach').next();
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(value.wait).toHaveBeenCalledOnce());
    await value.handle.detach();
    await rejected;
    expect(value.detach).toHaveBeenCalledOnce();
    expect(value.stream).not.toHaveBeenCalled();
  });

  it('surfaces connection failure instead of silently sending without IDE context', async () => {
    const stream = vi.fn();
    const handle = bindSessionIde({ stream, ensureLoaded: async () => {} } as unknown as DaemonSessionHandle, async () => {
      throw new Error('IDE connection timed out');
    });
    await expect(handle.stream('must not send').next()).rejects.toThrow('IDE connection timed out');
    expect(stream).not.toHaveBeenCalled();
  });

  it('restores an inactive worker before waiting for its replacement IDE handshake', async () => {
    const value = fixture();
    let loaded!: () => void;
    value.ensureLoaded.mockImplementationOnce(() => new Promise<void>((resolve) => { loaded = resolve; }));
    const result = value.handle.stream('continue the same chat').next();
    expect(value.wait).not.toHaveBeenCalled();
    expect(value.stream).not.toHaveBeenCalled();

    loaded();
    await vi.waitFor(() => expect(value.wait).toHaveBeenCalledOnce());
    expect(value.stream).not.toHaveBeenCalled();
    value.release();
    await expect(result).resolves.toMatchObject({ value: { text: 'ready' } });
    expect(value.stream).toHaveBeenCalledExactlyOnceWith('continue the same chat', { includePartialMessages: false });
  });

  it('does not wait for IDE or submit after cancellation during worker restoration', async () => {
    const value = fixture();
    let loaded!: () => void;
    value.ensureLoaded.mockImplementationOnce(() => new Promise<void>((resolve) => { loaded = resolve; }));
    const result = value.handle.stream('must not send after Stop').next();
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await value.handle.interrupt();
    loaded();
    await rejected;
    expect(value.wait).not.toHaveBeenCalled();
    expect(value.stream).not.toHaveBeenCalled();
  });

  it('keeps the prompt unsubmitted when worker restoration fails', async () => {
    const value = fixture();
    value.ensureLoaded.mockRejectedValueOnce(new Error('Session restore failed'));
    await expect(value.handle.stream('retained prompt').next()).rejects.toThrow('Session restore failed');
    expect(value.wait).not.toHaveBeenCalled();
    expect(value.stream).not.toHaveBeenCalled();
  });
});
