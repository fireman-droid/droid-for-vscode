import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useId, useMemo } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { SubagentInspectionState, useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation } from './AgentNavigation';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { ReadOnlyTranscript } from '../viewer/ReadOnlyTranscript';

export function WorkingSubagents({ transcript, flow, navigation, port }: {
  readonly transcript?: readonly SessionTranscriptItem[];
  readonly flow: ReturnType<typeof useSubagentPanelFlow>;
  readonly navigation?: AgentChatNavigationMessage | null;
  readonly port?: ChatPort;
}) {
  const tasks = useMemo(() => {
    const map = new Map<string, { readonly turnId: string; readonly toolUseId: string }>();
    if (!navigation || !port) return map;
    for (const item of transcript ?? []) {
      if (item.kind === 'tool' && item.subagent !== undefined) {
        map.set(item.toolUseId, { turnId: item.turnId, toolUseId: item.toolUseId });
      }
    }
    return map;
  }, [navigation, port, transcript]);
  if (!navigation || !port) return null;
  return <AgentNavigation navigation={navigation} port={port} tasks={tasks}
    inspectedToolUseId={flow.inspection?.toolUseId ?? null} onInspectTask={flow.inspectSubagent} />;
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
  const titleId = useId();
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
    <section role="dialog" aria-labelledby={titleId} className="dvx-subagent-sheet">
      <header className="dvx-subagent-dialog-head">
        <div className="dvx-subagent-dialog-heading">
          <h2 id={titleId} title={title} className="dvx-subagent-dialog-title">{title}</h2>
          {headerMeta ? <span role="status" data-ui-notice="" className="dvx-subagent-dialog-meta" data-failed={lifecycle === 'failed' || undefined}>{headerMeta}</span> : null}
        </div>
        <div className="dvx-subagent-dialog-actions">
          {onOpenExternal ? <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Open in tab")} title={t("Expand subagent session")} onClick={() => onOpenExternal(inspection.turnId, inspection.toolUseId)}><Maximize2 className="size-3.5" /></Button> : null}
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("Close subagent view")} title={t("Close")} onClick={onClose}><X className="size-3.5" /></Button>
        </div>
      </header>
      <div className="dvx-subagent-dialog-body">
        {snapshot === null || snapshot.status === 'loading' ? (
          <div className="v2-chat-rail overflow-auto py-4">
            <DroidLoading label={t("Loading session…")} detail={t("Reading the subagent conversation.")} />
          </div>
        ) : snapshot.status === 'unavailable' ? (
          <div className="v2-chat-rail grid min-h-[88px] place-items-center overflow-auto py-4 text-center text-xs text-muted-foreground">
            <p data-ui-notice="">{snapshot.reason ?? t("Subagent transcript is unavailable.")}</p>
          </div>
        ) : (
          <ReadOnlyTranscript key={`${inspection.turnId}:${inspection.toolUseId}`} items={snapshot.items} running={snapshot.running} truncated={snapshot.truncated} />
        )}
      </div>
    </section>
  );
}
