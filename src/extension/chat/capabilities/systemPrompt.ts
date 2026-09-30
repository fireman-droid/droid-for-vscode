import { parseSystemPromptPreference, toSessionSystemPrompt, type SystemPromptPreference, type SystemPromptRequest } from '../../../shared/protocol/systemPromptProtocol';
import type { FactoryDroidSessionFactory } from '../../../runtime/session/sessionTypes';
import type { SessionRecoveryPersistence } from '../../recovery/SessionRecoveryStore';
import type { ChatController } from '../ChatController';

const STORAGE_KEY = 'droidvisx.newSessionSystemPrompt';

/** Defaults for sessions created by this VS Code profile; never sent on resume. */
export class SystemPromptStore {
  constructor(private readonly persistence: SessionRecoveryPersistence) {}
  read(): SystemPromptPreference {
    return parseSystemPromptPreference(this.persistence.get(STORAGE_KEY)) ?? { mode: 'default' };
  }
  async save(preference: SystemPromptPreference): Promise<void> {
    const valid = parseSystemPromptPreference(preference);
    if (!valid) throw new Error('Invalid system prompt preference.');
    await this.persistence.update(STORAGE_KEY, valid);
  }
  sessionPrompt = () => toSessionSystemPrompt(this.read());
}

export function withSystemPromptDefaults(factory: FactoryDroidSessionFactory, store: SystemPromptStore): FactoryDroidSessionFactory {
  return (options) => {
    if (options.target.kind !== 'new' || options.target.systemPrompt !== undefined) return factory(options);
    const systemPrompt = store.sessionPrompt();
    return factory(systemPrompt === undefined ? options : { ...options, target: { ...options.target, systemPrompt } });
  };
}

export async function handleSystemPrompt(ctl: ChatController, message: SystemPromptRequest): Promise<void> {
  const store = ctl.systemPromptStore;
  let error: string | null = null;
  let preference: SystemPromptPreference = { mode: 'default' };
  try {
    if (!store) throw new Error('System prompt settings are unavailable.');
    if (message.type === 'systemPrompt.save') await store.save(message.preference);
    preference = store.read();
  } catch {
    error = 'Could not save or read system prompt settings. Reopen this dialog and try again.';
  }
  if (!ctl.sessionState.disposed) ctl.emit({ type: 'systemPrompt.state', requestId: message.requestId, preference, error });
}
