import { access } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi, DaemonSessionHandle } from '../daemon/api';
import { createModelManagementGateway } from './modelManagement';

function fixture() {
  const session = {
    id: 'verification-session',
    settings: { modelId: 'actual-id' },
    stream: vi.fn(async function* (_prompt: string, _options: unknown) {
      yield { type: 'result', success: true, text: 'OK', error: null };
    }),
    interrupt: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
  };
  const create = vi.fn(
    async (_options: { cwd: string }) => session as unknown as DaemonSessionHandle,
  );
  const archive = vi.fn(async () => ({ success: true, archivedAt: 'now' }));
  const updateSettings = vi.fn(async () => ({}));
  const daemon = {
    sessions: { create, archive, updateSettings },
  } as unknown as DaemonApi;
  return {
    session,
    create,
    archive,
    updateSettings,
    gateway: createModelManagementGateway(async () => daemon),
  };
}
describe('Droid model verification lifecycle', () => {
  it('uses a fresh directory, rejects permissions, and cleans up after a completed reply', async () => {
    const { gateway, create, session, archive, updateSettings } = fixture();
    const result = await gateway.verify('actual-id', new AbortController().signal);
    expect(result.status).toBe('passed');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'actual-id',
        autoRejectPermissionRequests: true,
        disableBuiltinSkills: true,
        mcpServers: [],
        privacyLevel: 'private',
      }),
    );
    expect(session.stream).toHaveBeenCalledWith(
      'Connection verification only. Do not use tools or inspect files. Reply with exactly OK.',
      { abortSignal: expect.any(AbortSignal) },
    );
    expect(session.close).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledWith('verification-session');
    expect(updateSettings).toHaveBeenCalledWith('verification-session', {
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    await expect(access(create.mock.calls[0]![0].cwd)).rejects.toThrow();
  });
  it('cleans up late creation after cancellation without sending a prompt', async () => {
    const { gateway, create, session, archive } = fixture();
    const abort = new AbortController();
    create.mockImplementationOnce(async () => {
      abort.abort();
      return session as unknown as DaemonSessionHandle;
    });
    expect((await gateway.verify('actual-id', abort.signal)).status).toBe('failed');
    expect(session.stream).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledOnce();
    await expect(access(create.mock.calls[0]![0].cwd)).rejects.toThrow();
  });
  it('does not claim success for a different model or failed cleanup', async () => {
    const first = fixture();
    first.session.settings.modelId = 'different';
    expect(
      (await first.gateway.verify('actual-id', new AbortController().signal)).status,
    ).toBe('failed');
    expect(first.session.stream).not.toHaveBeenCalled();
    const second = fixture();
    second.session.close.mockRejectedValueOnce(new Error('close failed'));
    const result = await second.gateway.verify('actual-id', new AbortController().signal);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('cleanup');
    expect(second.session.detach).toHaveBeenCalledOnce();
  });
});
