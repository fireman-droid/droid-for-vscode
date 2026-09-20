import { BookOpen, Folder, GitCompare } from 'lucide-react';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';

const starters = [
  { label: 'Understand this project', icon: BookOpen, prompt: 'Explain this codebase: identify the main entry points and how the key modules fit together. Do not change files.' },
  { label: 'Review current changes', icon: GitCompare, prompt: 'Review the current workspace changes for bugs and regressions. Explain your findings without changing files.' },
];

export function ChatStartup({ state, blocked, onDraftSuggestion }: {
  readonly state: Pick<AssistantWebviewState, 'connection' | 'sessionId' | 'workspaceRoot' | 'settings' | 'modelCatalog' | 'historyStatus'>;
  readonly blocked: boolean;
  readonly onDraftSuggestion?: (prompt: string) => void;
}) {
  if (state.connection.status === 'unavailable') return <section className="px-3 py-12 text-center" aria-label="Droid unavailable">
    <h2 className="text-sm font-medium">Droid is not ready</h2>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{state.connection.message ?? 'The local runtime is unavailable. Check the connection message below before reconnecting.'}</p>
  </section>;
  if (state.connection.status !== 'connected' || state.sessionId === null) return <div role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
    <DroidActivity phase="loading" /><span>{state.connection.status === 'connected' ? 'Waiting for the session state…' : 'Connecting to the local runtime…'}</span>
  </div>;
  const settings = state.settings;
  const modelId = settings.value?.interactionMode === 'spec'
    ? settings.value.specModeModelId ?? settings.value.modelId : settings.value?.modelId;
  const modelName = state.modelCatalog.items.find((entry) => entry.id === modelId)?.displayName ?? modelId;
  const modelStatus = settings.status === 'loading' ? 'Reading session settings…'
    : settings.status === 'updating' ? `Updating session settings${modelName ? ` · ${modelName}` : ''}…`
    : settings.status === 'error' ? settings.message : modelName ?? 'No model reported';
  const ready = settings.status === 'ready';
  const workspaceName = state.workspaceRoot?.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1);
  return <section className="v2-chat-startup" aria-label="Start a conversation">
    <p className="v2-startup-workspace" title={state.workspaceRoot ?? undefined}>
      <Folder aria-hidden="true" /><span>{workspaceName || 'Your workspace'}</span>
    </p>
    <h2>{ready ? 'What can I help with?' : 'Getting your session ready'}</h2>
    <p className="v2-startup-description">{state.historyStatus === 'unavailable'
      ? 'Earlier messages are unavailable here. You can continue this session.'
      : 'Ask about your code, or describe a change.'}</p>
    {!ready ? <p role="status" className="v2-startup-description">{modelStatus}</p> : null}
    {ready && onDraftSuggestion && !blocked ? <div className="v2-startup-actions">
      {starters.map(({ icon: Icon, ...starter }) => <Button key={starter.label} variant="plain" size="none"
        className="v2-startup-action" title="Add this task to the draft" onClick={() => onDraftSuggestion(starter.prompt)}>
        <Icon aria-hidden="true" /><span>{starter.label}</span>
      </Button>)}
    </div> : null}
  </section>;
}
