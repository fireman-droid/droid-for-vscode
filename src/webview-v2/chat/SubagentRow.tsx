import { memo, useEffect, useState } from 'react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { useSubagentActivity } from './subagents/subagentPanelFlow';
import { formatElapsed } from './subagents/subagentWorking';
import { formatDuration } from './thread/readers';
import { useToolActions } from '../content/toolActions';
import { ChevronRight, LoaderCircle } from 'lucide-react';
import { Button } from '../ui/button';

export const SubagentRow = memo(function SubagentRow({ item, variant = 'card' }: {
  readonly item: ToolTranscriptItem;
  readonly variant?: 'card' | 'row';
}) {
  const extras = useSubagentActivity(item.toolUseId);
  const actions = useToolActions();
  const subagent = item.subagent!;
  const status = subagent.status ?? (item.status === 'running' ? 'running' : undefined);
  const background = status === 'running' && (item.status === 'completed' || item.status === 'failed');
  const label = background ? 'Running in background' : status === undefined ? undefined : status.charAt(0).toUpperCase() + status.slice(1);
  const liveStartedAt = status === 'running' ? subagent.startedAt : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (liveStartedAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [liveStartedAt]);
  const elapsed = liveStartedAt !== undefined ? formatElapsed(Date.now() - liveStartedAt)
    : subagent.durationMs !== undefined ? formatDuration(subagent.durationMs) : undefined;
  return <Button variant="plain" size="none" disabled={!actions.openSubagent} onClick={() => actions.openSubagent?.(item.turnId, item.toolUseId)}
    className={`block space-y-1 rounded px-2 py-2 text-left text-xs outline-none hover:bg-[var(--control-surface-hover)] active:bg-[var(--control-surface-active)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none ${variant === 'card' ? 'ml-4 w-[calc(100%-16px)] border border-[var(--panel-edge)] bg-input-background' : 'w-full'}`}>
    <span className="flex items-center gap-1.5">{status === 'running' ? <LoaderCircle aria-hidden="true" className="size-3 shrink-0 motion-safe:animate-spin" /> : null}<span className="min-w-0 flex-1 truncate">{subagent.type} subagent</span>{label ? <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span> : null}<ChevronRight aria-hidden="true" className="size-3 shrink-0" /></span>
    {subagent.description ? <span className="block [overflow-wrap:anywhere]">{subagent.description}</span> : null}
    {extras?.activities[0] ? <span className="block truncate text-muted-foreground" title={extras.activities[0].target ?? undefined}>{extras.activities[0].action}{extras.activities[0].target ? ` · ${extras.activities[0].target}` : ''}</span>
      : (subagent.toolUseCount ?? 0) > 0 || status === 'running' ? <span className="block text-[11px] text-muted-foreground">{(subagent.toolUseCount ?? 0) > 0
        ? 'Tool calls reported · Open to view activity'
        : 'Waiting for activity…'}</span> : null}
    {elapsed !== undefined || subagent.toolUseCount !== undefined ? <span className="block text-[11px] text-muted-foreground">{[elapsed === undefined ? '' : `Elapsed ${elapsed}`, subagent.toolUseCount === undefined ? '' : `Tools ${subagent.toolUseCount}`].filter(Boolean).join(' · ')}</span> : null}
  </Button>;
});
