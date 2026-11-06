import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useMemo } from 'react';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { SubagentActivityStoreContext, type SubagentInspectionState, type useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation, AgentSection } from './AgentNavigation';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { ReadOnlyTranscript } from '../viewer/ReadOnlyTranscript';

export function WorkingSubagents({ working, transcript, flow, navigation, port }: {
  readonly working: readonly ToolTranscriptItem[];
  readonly transcript?: readonly SessionTranscriptItem[];
  readonly flow: ReturnType<typeof useSubagentPanelFlow>;
  readonly navigation?: AgentChatNavigationMessage | null;
  readonly port?: ChatPort;
}) {
  const tasks = useMemo(() => {
    const map = new Map<string, { readonly turnId: string; readonly toolUseId: string }>();
    for (const item of transcript ?? working) {
      if (item.kind === 'tool' && item.subagent !== undefined) {
        map.set(item.toolUseId, { turnId: item.turnId, toolUseId: item.toolUseId });
      }
    }
    return map;
  }, [transcript, working]);
  if (navigation && port) {
    return <AgentNavigation navigation={navigation} port={port} tasks={tasks}
      inspectedToolUseId={flow.inspection?.toolUseId ?? null} onInspectTask={flow.inspectSubagent} />;
  }
  if (working.length === 0) return null;
  return <AgentSection count={working.length} running={working.length}>
      <SubagentActivityStoreContext.Provider value={flow.activityStore}>
        <ToolActionsContext.Provider value={{ openSubagent: flow.inspectSubagent }}>
          {working.map((item) => <li key={item.toolUseId}><SubagentRow item={item} variant="row" /></li>)}
        </ToolActionsContext.Provider>
      </SubagentActivityStoreContext.Provider>
  </AgentSection>;
}

export function InlineSubagentOverlay({ inspection, transcript, onClose, onOpenExternal }: {
  readonly inspection: SubagentInspectionState;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly onClose: () => void;
  readonly onOpenExternal?: (turnId: string, toolUseId: string) => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const taskItem = transcript.find(
    (item): item is ToolTranscriptItem => item.kind === 'tool' && item.toolUseId === inspection.toolUseId,
  );
  const snapshot = inspection.snapshot;
  const title = snapshot?.title ?? taskItem?.subagent?.description ?? t("Subagent activity");
  const lifecycle = snapshot?.lifecycle ?? (taskItem?.subagent?.status === 'running' ? 'working'
    : taskItem?.subagent?.status === 'completed' ? 'completed'
    : taskItem?.subagent?.status === 'failed' ? 'failed'
    : taskItem?.subagent?.status === 'cancelled' ? 'cancelled' : null);
  const statusLabel = snapshot === null || snapshot.status === 'loading'
    ? t("Loading")
    : lifecycle ? t(lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1)) : t("Ready");
  return (
    <section aria-label={t("Subagent activity")} className="v2-session-viewer v2-chat-surface absolute inset-0 z-20 grid min-h-0 min-w-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="border-b border-[var(--panel-edge)]">
        <div className="v2-chat-rail flex min-h-9 items-center justify-between gap-2 py-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" aria-label={t("Back to main chat")} onClick={onClose}>
            <ArrowLeft className="size-3.5" /><span>{t("Back")}</span>
          </Button>
          <h2 title={title} className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{title}</h2>
          <p role="status" data-ui-notice="" className={`shrink-0 select-none text-[11px] ${lifecycle === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLabel}</p>
          {onOpenExternal ? <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Open in tab")} title={t("Open in tab")} onClick={() => onOpenExternal(inspection.turnId, inspection.toolUseId)}><ExternalLink className="size-3.5" /></Button> : null}
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Close subagent view")} title={t("Close")} onClick={onClose}><X className="size-3.5" /></Button>
        </div>
      </header>
      {snapshot === null || snapshot.status === 'loading' ? (
        <div className="v2-chat-rail overflow-auto py-6">
          <DroidLoading label={t("Loading session…")} detail={t("Reading the subagent conversation.")} />
        </div>
      ) : snapshot.status === 'unavailable' ? (
        <div className="v2-chat-rail grid min-h-[180px] place-items-center overflow-auto py-6 text-center text-xs text-muted-foreground">
          <p data-ui-notice="">{snapshot.reason ?? t("Subagent transcript is unavailable.")}</p>
        </div>
      ) : (
        <ReadOnlyTranscript key={`${inspection.turnId}:${inspection.toolUseId}`} items={snapshot.items} running={snapshot.running} truncated={snapshot.truncated} />
      )}
    </section>
  );
}
