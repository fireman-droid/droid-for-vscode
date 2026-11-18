import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useMemo } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { SubagentActivityStoreContext, type SubagentInspectionState, type useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation, AgentSection } from './AgentNavigation';
import { Button } from '../ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
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

function formatRole(role: string | undefined): string {
  const trimmed = role?.trim();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : '';
}

export function InlineSubagentOverlay({ inspection, transcript, onClose, onOpenExternal }: {
  readonly inspection: SubagentInspectionState;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly onClose: () => void;
  readonly onOpenExternal?: (turnId: string, toolUseId: string) => void;
}) {
  const { t } = useI18n();
  const taskItem = transcript.find(
    (item): item is ToolTranscriptItem => item.kind === 'tool' && item.toolUseId === inspection.toolUseId,
  );
  const snapshot = inspection.snapshot;
  const title = snapshot?.title ?? taskItem?.subagent?.description ?? t("Subagent activity");
  const roleLabel = formatRole(taskItem?.subagent?.type);
  const lifecycle = snapshot?.lifecycle ?? (taskItem?.subagent?.status === 'running' ? 'running'
    : taskItem?.subagent?.status === 'completed' ? 'completed'
    : taskItem?.subagent?.status === 'failed' ? 'failed'
    : taskItem?.subagent?.status === 'cancelled' ? 'cancelled' : null);
  const statusText = snapshot === null || snapshot.status === 'loading'
    ? t("Loading")
    : lifecycle === 'cancelled' ? t("Stopped")
    : lifecycle ? t(lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1)) : t("Ready");
  const headerMeta = [roleLabel, statusText].filter(Boolean).join(' · ');
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="dvx-subagent-dialog-overlay"
        className="dvx-subagent-dialog v2-chat-surface inset-auto left-1/2 top-1/2 grid h-[min(580px,calc(100vh-56px))] max-h-[calc(100vh-32px)] w-[min(740px,calc(100vw-24px))] max-w-none -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
        hideCloseButton
        onEscapeKeyDown={(event) => {
          if (event.isComposing) event.preventDefault();
        }}
      >
        <header className="dvx-subagent-dialog-head">
          <div className="dvx-subagent-dialog-heading">
            <DialogTitle title={title} className="dvx-subagent-dialog-title">{title}</DialogTitle>
            <DialogDescription className="sr-only">{t("Subagent transcript")}</DialogDescription>
            {headerMeta ? <span role="status" data-ui-notice="" className="dvx-subagent-dialog-meta" data-failed={lifecycle === 'failed' || undefined}>{headerMeta}</span> : null}
          </div>
          <div className="dvx-subagent-dialog-actions">
            {onOpenExternal ? <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Open in tab")} title={t("Expand subagent session")} onClick={() => onOpenExternal(inspection.turnId, inspection.toolUseId)}><Maximize2 className="size-3.5" /></Button> : null}
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Close subagent view")} title={t("Close")}><X className="size-3.5" /></Button>
            </DialogClose>
          </div>
        </header>
        <div className="dvx-subagent-dialog-body">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
