import { BookOpen, Folder, GitCompare, LoaderCircle, Unplug } from 'lucide-react';
import type { AssistantWebviewState } from '../state/types';
import { Button } from '../ui/button';

const starters = [
  { label: 'Understand this project', icon: BookOpen, prompt: 'Explain this codebase: identify the main entry points and how the key modules fit together. Do not change files.' },
  { label: 'Review current changes', icon: GitCompare, prompt: 'Review the current workspace changes for bugs and regressions. Explain your findings without changing files.' },
];

export function ChatStartup({ state, blocked, onDraftSuggestion }: {
  readonly state: Pick<AssistantWebviewState, 'connection' | 'sessionId' | 'workspaceRoot' | 'settings' | 'modelCatalog' | 'historyStatus'>;
  readonly blocked: boolean;
  readonly onDraftSuggestion?: (prompt: string) => void;
}) {
  if (blocked) return null;
  if (state.connection.status === 'unavailable') return <div role="alert" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
    <Unplug aria-hidden="true" className="size-3.5 shrink-0" /><span>Unable to connect. Open the connection status above.</span>
  </div>;
  if (state.connection.status !== 'connected' || state.sessionId === null) return <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
    <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /><span>{state.connection.status === 'connected' ? 'Restoring session…' : 'Connecting to Droid…'}</span>
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
