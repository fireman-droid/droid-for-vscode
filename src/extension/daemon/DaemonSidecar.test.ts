import { afterEach, describe, expect, it, vi } from 'vitest';

import { warmDaemonSidecar } from './DaemonSidecar';

describe('warmDaemonSidecar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a lazy facade’s real warmup before reporting readiness', async () => {
    let ready!: () => void;
    const warmup = vi.fn(() => new Promise<void>(resolve => { ready = resolve; }));
    const droid = vi.fn();
    const record = vi.fn();
    warmDaemonSidecar({ droid, warmup }, { record });
    await Promise.resolve();
    expect(warmup).toHaveBeenCalledOnce();
    expect(droid).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ name: 'daemon.sidecar.warmed' })));
  });

  it('retries one failed warmup once', async () => {
    vi.useFakeTimers();
    const droid = vi
      .fn()
      .mockRejectedValueOnce(new Error('daemon unavailable'))
      .mockResolvedValueOnce({} as never);
    const record = vi.fn();

    warmDaemonSidecar({ droid }, { record });
    await vi.advanceTimersByTimeAsync(0);
    expect(droid).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(droid).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        name: 'daemon.sidecar.warm-failed',
        attributes: { attempt: 1 },
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        name: 'daemon.sidecar.warmed',
        attributes: { attempt: 2 },
      }),
    );
  });
});
