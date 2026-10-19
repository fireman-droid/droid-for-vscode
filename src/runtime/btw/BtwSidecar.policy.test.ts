import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../daemon/api';
import { createDaemonBtwSidecar } from './DaemonBtwSidecar';
import { createBtwSidecar, type BtwSidecarClient } from './BtwSidecar';
import { prepareBtwToolPolicy } from './btwToolPolicy';

vi.mock('./btwToolPolicy', async importOriginal => ({
  ...await importOriginal<typeof import('./btwToolPolicy')>(),
  prepareBtwToolPolicy: vi.fn(),
}));

const policy = { disabledToolIds: ['Edit', 'Execute', 'Task', 'mcp___write'],
  autoRejectPermissionRequests: true, disableBuiltinSkills: true };

function daemonFixture() {
  const stream = vi.fn(async function* () { yield { type: 'result', subtype: 'success' }; });
  const droid = { sessions: {
    fork: vi.fn(async () => ({ newSessionId: 'fork-1' })),
    resume: vi.fn(async () => ({ stream, close: vi.fn() })),
    updateSettings: vi.fn(async () => ({})),
  } };
  return { droid, stream, getDroid: async () => droid as unknown as DaemonApi };
}

describe('BTW adapter policy admission', () => {
  it('loads daemon restrictions before attaching and retains them through model changes and later questions', async () => {
    vi.mocked(prepareBtwToolPolicy).mockResolvedValueOnce(policy);
    const { droid, stream, getDroid } = daemonFixture();
    const sidecar = await createDaemonBtwSidecar({ cwd: 'C:/workspace', mainSessionId: 'main-1', getDroid });
    expect(prepareBtwToolPolicy).toHaveBeenLastCalledWith('C:/workspace', 'fork-1');
    expect(droid.sessions.resume).toHaveBeenCalledWith('fork-1', expect.objectContaining(policy));
    for await (const _event of sidecar.ask('explain', { modelId: 'other-model' })) { /* drain */ }
    for await (const _event of sidecar.ask('continue')) { /* drain */ }
    expect(droid.sessions.updateSettings).toHaveBeenNthCalledWith(1, 'fork-1', expect.objectContaining({
      modelId: 'other-model', autonomyLevel: 'off', disabledToolIds: policy.disabledToolIds,
    }));
    expect(droid.sessions.updateSettings).toHaveBeenNthCalledWith(2, 'fork-1', expect.objectContaining({
      autonomyLevel: 'off', disabledToolIds: policy.disabledToolIds,
    }));
    expect(droid.sessions.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(stream.mock.invocationCallOrder[0]!);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('does not attach or send when daemon restrictions cannot be established', async () => {
    vi.mocked(prepareBtwToolPolicy).mockRejectedValueOnce(new Error('policy unavailable'));
    const { droid, stream, getDroid } = daemonFixture();
    await expect(createDaemonBtwSidecar({ cwd: 'C:/workspace', mainSessionId: 'main-1', getDroid }))
      .rejects.toThrow('policy unavailable');
    expect(droid.sessions.resume).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('closes a process client rather than returning an unrestricted sidecar', async () => {
    const client = {
      loadSession: vi.fn(async () => ({})),
      forkSession: vi.fn(async () => ({ result: { newSessionId: 'fork-1' } })),
      loadSideQuestionSession: vi.fn(async () => { throw new Error('policy unavailable'); }),
      close: vi.fn(async () => undefined),
      addUserMessage: vi.fn(),
    };
    await expect(createBtwSidecar({ cwd: 'C:/workspace', mainSessionId: 'main-1',
      createClient: async () => client as unknown as BtwSidecarClient })).rejects.toThrow('policy unavailable');
    expect(client.loadSession).toHaveBeenCalledWith({ sessionId: 'main-1' });
    expect(client.loadSideQuestionSession).toHaveBeenCalledWith({ sessionId: 'fork-1' });
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.addUserMessage).not.toHaveBeenCalled();
  });
});
