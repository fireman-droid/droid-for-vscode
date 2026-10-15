import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolConfirmationOutcome } from '@factory/droid-sdk/node';
import { createBtwSidecar } from './BtwSidecar';
import { restrictBtwTools } from './btwToolPolicy';
import { createBtwAnalysisTools } from './btwAnalysisTools';

const fake = vi.hoisted(() => ({
  loadSession: vi.fn(async () => ({})), forkSession: vi.fn(async () => ({ result: { newSessionId: 'fork' } })),
  addUserMessage: vi.fn(async () => ({})), updateSessionSettings: vi.fn(async () => ({})),
  interruptSession: vi.fn(async () => ({})), closeSession: vi.fn(async () => ({})), close: vi.fn(async () => undefined),
  onNotification: vi.fn((_callback: (event: Record<string, unknown>) => void) => () => undefined),
  onError: vi.fn(() => () => undefined), setPermissionHandler: vi.fn(),
}));
vi.mock('@factory/droid-sdk/node', async importOriginal => ({
  ...await importOriginal<typeof import('@factory/droid-sdk/node')>(),
  ProcessTransport: class { async connect() {} async close() {} },
  DroidClient: class { constructor() { return fake; } },
}));
vi.mock('./btwToolPolicy', () => ({ restrictBtwTools: vi.fn() }));
vi.mock('./btwAnalysisTools', async importOriginal => ({
  ...await importOriginal<typeof import('./btwAnalysisTools')>(),
  createBtwAnalysisTools: vi.fn(async () => ({ mcpServers: [], toolIds: new Set(['owned___run_javascript']),
    cancel: vi.fn(), close: vi.fn(async () => undefined) })),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(restrictBtwTools).mockResolvedValue({ disabledToolIds: ['Execute', 'Edit'], disableBuiltinSkills: true });
});

describe('BTW process adapter', () => {
  it('adds explanation guidance and owned tools only to BTW; stops analysis and closes its bridge', async () => {
    const sidecar = await createBtwSidecar({ cwd: 'workspace', mainSessionId: 'main' });
    const analysis = await vi.mocked(createBtwAnalysisTools).mock.results[0]!.value;
    expect(restrictBtwTools).toHaveBeenCalledWith(fake, 'fork', true, analysis);
    const permission = fake.setPermissionHandler.mock.calls[0]![0];
    const params = { toolUses: [{ toolUse: { name: 'owned___run_javascript' } }], options: [{ value: ToolConfirmationOutcome.ProceedOnce }] };
    expect(permission({ params })).toBe(ToolConfirmationOutcome.ProceedOnce);
    expect(permission({ params: { ...params, toolUses: [{ toolUse: { name: 'Execute' } }] } })).toBe(ToolConfirmationOutcome.Cancel);
    fake.addUserMessage.mockImplementationOnce(async () => {
      fake.onNotification.mock.calls.at(-1)![0]({ type: 'agent_turn_completed' });
      return {};
    });
    for await (const _event of sidecar.ask('what does this do?', { modelId: 'chosen' })) { /* drain */ }
    expect(fake.addUserMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('eli5') }));
    expect(fake.updateSessionSettings).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'chosen', autonomyLevel: 'off', disabledToolIds: ['Execute', 'Edit'] }));
    const pending = sidecar.ask('again').next();
    await vi.waitFor(() => expect(fake.addUserMessage).toHaveBeenCalledTimes(2));
    await sidecar.interrupt?.();
    expect(analysis.cancel).toHaveBeenCalledOnce();
    await sidecar.dispose();
    await pending;
    expect(analysis.close).toHaveBeenCalledOnce();
  });

  it('keeps Review tool-free and preserves its own explanation prompt', async () => {
    const sidecar = await createBtwSidecar({ cwd: 'workspace', mainSessionId: 'main', readOnly: true });
    expect(createBtwAnalysisTools).not.toHaveBeenCalled();
    expect(restrictBtwTools).toHaveBeenCalledWith(fake, 'fork', false);
    fake.addUserMessage.mockImplementationOnce(async () => {
      fake.onNotification.mock.calls.at(-1)![0]({ type: 'agent_turn_completed' });
      return {};
    });
    for await (const _event of sidecar.ask('review-specific prompt')) { /* drain */ }
    expect(fake.addUserMessage).toHaveBeenLastCalledWith({ text: 'review-specific prompt' });
    await sidecar.dispose();
  });

  it('closes the local tool bridge if admission fails', async () => {
    vi.mocked(restrictBtwTools).mockRejectedValueOnce(new Error('unsafe backend'));
    await expect(createBtwSidecar({ cwd: 'workspace', mainSessionId: 'main' })).rejects.toThrow('unsafe backend');
    const analysis = await vi.mocked(createBtwAnalysisTools).mock.results[0]!.value;
    expect(analysis.close).toHaveBeenCalledOnce();
  });
});
