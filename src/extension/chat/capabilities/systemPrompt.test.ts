import { describe, expect, it, vi } from 'vitest';
import { SystemPromptStore, withSystemPromptDefaults } from './systemPrompt';
import { createLocalDroidSession, type LocalSessionDependencies } from '../../../runtime/process/createLocalDroidSession';
import type { FactoryDroidSession } from '../../../runtime/session/sessionTypes';
import { cancellingRuntimeInteractionHandler } from '../../../runtime/events/runtimeInteractions';
import { parseSystemPromptPreference, parseSystemPromptRequest, type SystemPromptPreference } from '../../../shared/protocol/systemPromptProtocol';

function setup() {
  let saved: unknown;
  const update = vi.fn(async (_key: string, value: unknown) => { saved = value; });
  const store = new SystemPromptStore({ get: <T>() => saved as T | undefined, update });
  const session = { id: 'synthetic-session', close: vi.fn(async () => {}) } as unknown as FactoryDroidSession;
  const deps: LocalSessionDependencies = {
    createTransport: () => ({ isConnected: true, connect: vi.fn(async () => {}), close: vi.fn(async () => {}), send: vi.fn(async () => {}), onMessage: vi.fn(), onError: vi.fn() }),
    createSession: vi.fn(async () => session),
    resumeSession: vi.fn(async () => session),
    listModels: vi.fn(async () => []),
  };
  const factory = withSystemPromptDefaults((options) => createLocalDroidSession(options, deps), store);
  return { store, deps, update, factory };
}

describe('new-session system prompts', () => {
  it.each<SystemPromptPreference>([{ mode: 'default' }, { mode: 'append', text: 'Synthetic appended instruction' }, { mode: 'replace', text: 'Synthetic replacement' }])('sends the saved $mode prompt through the Process creation path', async (preference) => {
    const { store, factory, deps } = setup();
    await store.save(preference);
    await factory({ target: { kind: 'new', cwd: 'C:/synthetic' }, interactionHandler: cancellingRuntimeInteractionHandler });
    const options = vi.mocked(deps.createSession).mock.calls[0]?.[0];
    expect(options?.systemPrompt).toEqual(preference.mode === 'default' ? undefined : preference.mode === 'replace' ? preference.text : { type: 'preset', preset: 'droid', append: preference.text });
  });

  it('never changes the prompt of a restored or forked session', async () => {
    const { store, factory, deps } = setup();
    await store.save({ mode: 'replace', text: 'New sessions only' });
    await factory({ target: { kind: 'resume', cwd: 'C:/synthetic', sessionId: 'existing-or-forked-session' }, interactionHandler: cancellingRuntimeInteractionHandler });
    expect(deps.createSession).not.toHaveBeenCalled();
    expect(deps.resumeSession).toHaveBeenCalledWith('existing-or-forked-session', expect.not.objectContaining({ systemPrompt: expect.anything() }));
  });

  it('retains the last saved prompt when persistence rejects a change', async () => {
    const { store, update, factory, deps } = setup();
    await store.save({ mode: 'append', text: 'Original preference' });
    update.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(store.save({ mode: 'replace', text: 'Not saved' })).rejects.toThrow();
    await factory({ target: { kind: 'new', cwd: 'C:/synthetic' }, interactionHandler: cancellingRuntimeInteractionHandler });
    expect(vi.mocked(deps.createSession).mock.calls[0]?.[0].systemPrompt).toEqual({ type: 'preset', preset: 'droid', append: 'Original preference' });
  });

  it('rejects malformed and oversized prompts at the Bridge boundary', () => {
    expect(parseSystemPromptPreference({ mode: 'append', text: ' ' })).toBeUndefined();
    expect(parseSystemPromptPreference({ mode: 'default', text: 'hidden' })).toBeUndefined();
    expect(parseSystemPromptRequest({ type: 'systemPrompt.save', requestId: 'request', preference: { mode: 'replace', text: 'x'.repeat(32_001) } })).toBeUndefined();
  });
});
