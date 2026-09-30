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
  const label = background ? 'Running in background' : status === undefined ? 'Status unavailable' : status.charAt(0).toUpperCase() + status.slice(1);
  const liveStartedAt = status === 'running' ? subagent.startedAt : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (liveStartedAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [liveStartedAt]);
  const elapsed = liveStartedAt !== undefined ? formatElapsed(Date.now() - liveStartedAt)
    : subagent.durationMs !== undefined ? formatDuration(subagent.durationMs) : undefined;
  const task = subagent.description || `${subagent.type} subagent`;
  const latestActivity = extras?.activities[0];
  return <Button variant="plain" size="none" disabled={!actions.openSubagent} onClick={() => actions.openSubagent?.(item.turnId, item.toolUseId)}
    className={`block w-full min-w-0 space-y-1 rounded px-2 text-left text-xs outline-none hover:bg-[var(--control-surface-hover)] active:bg-[var(--control-surface-active)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none ${variant === 'card' ? 'py-1.5' : 'py-2'}`}>
    <span className="flex items-start gap-1.5"><span className="min-w-0 flex-1 font-medium text-foreground [overflow-wrap:anywhere]">{task}</span><ChevronRight aria-hidden="true" className="mt-0.5 size-3 shrink-0" /></span>
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>{subagent.type} subagent{subagent.toolUseCount !== undefined ? ` · ${subagent.toolUseCount} tools` : ''}</span>
      <span className={`ml-auto inline-flex items-center gap-1 ${status === 'failed' ? 'text-destructive' : ''}`}>
        {status === 'running' ? <LoaderCircle aria-hidden="true" className="size-3 shrink-0 motion-safe:animate-spin" /> : null}
        <span>{label}{elapsed !== undefined ? ` · ${elapsed}` : ''}</span>
      </span>
    </span>
    {latestActivity ? <span className="block truncate text-[11px] text-muted-foreground" title={[latestActivity.action, latestActivity.target].filter(Boolean).join(' · ')}>{latestActivity.action}{latestActivity.target ? ` · ${latestActivity.target}` : ''}</span>
      : (subagent.toolUseCount ?? 0) > 0 || status === 'running' ? <span className="block text-[11px] text-muted-foreground">{(subagent.toolUseCount ?? 0) > 0
        ? 'Tool calls reported · Open to view activity'
        : 'Waiting for activity…'}</span> : null}
  </Button>;
});
