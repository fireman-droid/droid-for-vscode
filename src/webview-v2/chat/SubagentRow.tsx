import { memo, useEffect, useRef, useState } from 'react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { useSubagentActivity } from '../../webview/assistant/subagents/subagentPanelFlow';
import { formatElapsed } from '../../webview/assistant/subagents/subagentWorking';
import { formatDuration } from '../../webview/assistant/thread/readers';
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
  const status = subagent.status ?? (item.status === 'running' ? 'running' : 'pending');
  const background = status === 'running' && (item.status === 'completed' || item.status === 'failed');
  const label = background ? 'Running in background' : status.charAt(0).toUpperCase() + status.slice(1);
  const started = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'running' || subagent.durationMs !== undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status, subagent.durationMs]);
  const elapsed = subagent.durationMs !== undefined ? formatDuration(subagent.durationMs) : status === 'running' ? formatElapsed(Date.now() - started.current) : '—';
  return <Button variant="plain" size="none" disabled={!actions.openSubagent} onClick={() => actions.openSubagent?.(item.turnId, item.toolUseId)}
    className={`block space-y-1 rounded px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none ${variant === 'card' ? 'ml-4 w-[calc(100%-16px)] border border-border bg-input-background' : 'w-full'}`}>
    <span className="flex items-center gap-1.5">{status === 'running' ? <LoaderCircle className="size-3 shrink-0 motion-safe:animate-spin" /> : null}<span className="min-w-0 flex-1 truncate">{subagent.type} subagent</span><span className="text-[10px] text-muted-foreground">{label}</span><ChevronRight className="size-3" /></span>
    {subagent.description ? <span className="block break-words">{subagent.description}</span> : null}
    {extras?.activities[0] ? <span className="block truncate text-muted-foreground" title={extras.activities[0].target ?? undefined}>{extras.activities[0].action}{extras.activities[0].target ? ` · ${extras.activities[0].target}` : ''}</span>
      : <span className="block text-[11px] text-muted-foreground">{(subagent.toolUseCount ?? 0) > 0
        ? 'Tool calls reported · Open to view activity'
        : status === 'running' ? 'Waiting for activity…' : 'No activity details available'}</span>}
    <span className="block text-[11px] text-muted-foreground">Elapsed {elapsed}{subagent.toolUseCount === undefined ? '' : ` · Tools ${subagent.toolUseCount}`}</span>
  </Button>;
});
