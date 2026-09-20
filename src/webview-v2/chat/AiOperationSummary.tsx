import { useContext } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { isConfirmedOperationFile } from '../../shared/protocol/operationDiff';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
import { Button } from '../ui/button';

export interface OperationSummary {
  readonly turnId: string;
  readonly files: ReadonlySet<string>;
  readonly calls: ReadonlySet<string>;
  readonly unconfirmed: number;
  readonly delegated: boolean;
}

export function summarizeOperations(items: readonly SessionTranscriptItem[], turnId?: string): ReadonlyMap<string, OperationSummary> {
  const summaries = new Map<string, { turnId: string; files: Set<string>; calls: Set<string>; unconfirmed: number; delegated: boolean }>();
  for (const item of items) {
    if (item.kind !== 'tool' || turnId !== undefined && item.turnId !== turnId) continue;
    const summary = summaries.get(item.turnId) ?? { turnId: item.turnId, files: new Set<string>(), calls: new Set<string>(), unconfirmed: 0, delegated: false };
    if (item.subagent !== undefined) { summary.delegated = true; summaries.set(item.turnId, summary); }
    const diff = item.operationDiff;
    if (diff?.status !== 'ready' || diff.source !== 'tool-result') continue;
    const identity = JSON.stringify([diff.sourceSessionId ?? '', diff.callId ?? item.toolUseId]);
    if (summary.calls.has(identity)) continue;
    summary.calls.add(identity);
    for (const file of diff.files) {
      if (isConfirmedOperationFile(diff, file)) summary.files.add(file.path);
      else summary.unconfirmed += 1;
    }
    summaries.set(item.turnId, summary);
  }
  return summaries;
}

export function AiOperationSummary({ summary }: { readonly summary: OperationSummary }) {
  const context = useContext(InlineDiffContext);
  return <div className="my-2 text-[11px] text-muted-foreground" role="group" aria-label="AI operation summary">
    <Button variant="plain" size="none" className="text-left hover:text-foreground" disabled={!context?.connected || !context.sessionId}
      onClick={() => context?.sessionId && context.port.postMessage({
        type: 'review.panel.open', sessionId: context.sessionId, scopeKind: 'operations', turnId: summary.turnId,
      })}>
      AI operations · {summary.files.size} directly confirmed {summary.files.size === 1 ? 'file' : 'files'} · {summary.calls.size} tool {summary.calls.size === 1 ? 'result' : 'results'}
      {summary.unconfirmed ? ` · ${summary.unconfirmed} failed or unconfirmed file results` : ''}
    </Button>
    <p>{summary.delegated ? 'Delegated results are resolved in Review and are not included in these direct counts. ' : ''}Recorded tool results, separate from workspace net changes.</p>
  </div>;
}
