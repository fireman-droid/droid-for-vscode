import { useI18n } from '@droidvisx/chat-ui/i18n';
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
  const { t } = useI18n();
  if (blocked) return null;
  if (state.connection.status === 'unavailable') return <div role="alert" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
    <Unplug aria-hidden="true" className="size-3.5 shrink-0" /><span>{t("Unable to connect.")}</span>
  </div>;
  if (state.connection.status !== 'connected' || state.sessionId === null) return <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
    <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /><span>{state.connection.status === 'connected' ? t("Restoring session…") : t("Connecting to Droid…")}</span>
  </div>;
  const settings = state.settings;
  const modelId = settings.value?.interactionMode === 'spec'
    ? settings.value.specModeModelId ?? settings.value.modelId : settings.value?.modelId;
  const modelName = state.modelCatalog.items.find((entry) => entry.id === modelId)?.displayName ?? modelId;
  const modelStatus = settings.status === 'loading' ? 'Reading session settings…'
    : settings.status === 'updating' ? `${t('Updating session settings…')}${modelName ? ` · ${modelName}` : ''}`
    : settings.status === 'error' ? settings.message : modelName ?? 'No model reported';
  const ready = settings.status === 'ready';
  const workspaceName = state.workspaceRoot?.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1);
  return <section className="v2-chat-startup" aria-label={t("Start a conversation")}>
    <p className="v2-startup-workspace" title={state.workspaceRoot ?? undefined}>
      <Folder aria-hidden="true" /><span>{workspaceName || t("Your workspace")}</span>
    </p>
    <h2>{ready ? t("What can I help with?") : t("Getting your session ready")}</h2>
    <p className="v2-startup-description">{state.historyStatus === 'unavailable'
      ? t("Earlier messages are unavailable here. You can continue this session.")
      : t("Ask about your code, or describe a change.")}</p>
    {!ready ? <p role="status" className="v2-startup-description">{t(modelStatus)}</p> : null}
    {ready && onDraftSuggestion && !blocked ? <div className="v2-startup-actions">
      {starters.map(({ icon: Icon, ...starter }) => <Button key={t(starter.label)} variant="plain" size="none"
        className="v2-startup-action" title={t("Add this task to the draft")} onClick={() => onDraftSuggestion(starter.prompt)}>
        <Icon aria-hidden="true" /><span>{t(starter.label)}</span>
      </Button>)}
    </div> : null}
  </section>;
}
