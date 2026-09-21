import { describe, expect, it, vi } from 'vitest';
import { createWindowDaemonSidecar } from './WindowDaemonSidecar';

const pool = vi.hoisted(() => ({
  current: vi.fn(), dispose: vi.fn(), onConnection: vi.fn(() => vi.fn()),
}));
vi.mock('../../runtime/daemon/windowDaemonPool', () => ({
  WindowDaemonPool: class {
    current = pool.current;
    dispose = pool.dispose;
    onConnection = pool.onConnection;
  },
}));

describe('window daemon cold start', () => {
  it('lets root initialization start without metadata while warmup still waits for its real connection', async () => {
    let connected!: () => void;
    pool.current.mockImplementationOnce(() => new Promise<void>(resolve => { connected = resolve; }));
    const sidecar = createWindowDaemonSidecar({ record: vi.fn() }, vi.fn());
    const api = await sidecar.droid();
    expect(api.sessions.create).toBeTypeOf('function');
    expect(pool.current).not.toHaveBeenCalled();

    let warmed = false;
    const warmup = sidecar.warmup!().then(() => { warmed = true; });
    await Promise.resolve();
    expect(pool.current).toHaveBeenCalledOnce();
    expect(warmed).toBe(false);
    connected();
    await warmup;
    expect(warmed).toBe(true);
    await sidecar.dispose();
  });
});
