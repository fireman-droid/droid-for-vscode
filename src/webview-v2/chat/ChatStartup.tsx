import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';

const starters = [
  { label: 'Understand this project', prompt: 'Explain this codebase: identify the main entry points and how the key modules fit together. Do not change files.' },
  { label: 'Review current changes', prompt: 'Review the current workspace changes for bugs and regressions. Explain your findings without changing files.' },
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
  return <section className="mx-auto max-w-md space-y-3 px-3 py-12 text-center" aria-label="Start a conversation">
    <h2 className="text-sm font-medium">{ready ? 'Ready in your workspace' : 'Droid connected'}</h2>
    <dl className="space-y-1 text-xs leading-relaxed text-muted-foreground">
      <div><dt className="inline">Workspace: </dt><dd className="inline break-all">{state.workspaceRoot ?? 'Not reported by the extension'}</dd></div>
      <div><dt className="inline">Model: </dt><dd className="inline break-words" role={settings.status === 'error' ? 'status' : undefined}>{modelStatus}</dd></div>
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">{state.historyStatus === 'unavailable'
      ? 'Earlier messages are unavailable here. You can continue this session.'
      : 'Describe a task below. Use @ to add workspace files, and choose the model and mode beside the message field.'}</p>
    {ready && onDraftSuggestion && !blocked ? <div className="space-y-1">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">{starters.map((starter) => <Button key={starter.label} variant="link" size="sm"
        className="h-auto px-0 py-1 text-xs" title="Add this task to the draft" onClick={() => onDraftSuggestion(starter.prompt)}>{starter.label}</Button>)}</div>
      <p className="text-[11px] text-muted-foreground">Adds a draft for you to review; nothing is sent.</p>
    </div> : null}
  </section>;
}
