import {
  activeActivityIndex,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from './activityGrouping';
import { readToolActivity } from '../thread/readers';
import { resolveToolAction } from '../../../shared/transcript/toolActivity';

export interface ProcessWaiting {
  readonly turnId: string;
  readonly permissions: number;
  readonly questions: number;
}

export function currentProcessWaiting(
  sessionId: string | null,
  turn: { readonly turnId: string; readonly status: string } | null,
  interactions: readonly {
    readonly sessionId: string;
    readonly turnId: string;
    readonly request: { readonly kind: string };
  }[],
): ProcessWaiting | null {
  if (
    sessionId === null ||
    turn === null ||
    (turn.status !== 'streaming' && turn.status !== 'submitting')
  )
    return null;
  let permissions = 0;
  let questions = 0;
  for (const pending of interactions) {
    if (pending.sessionId !== sessionId || pending.turnId !== turn.turnId) continue;
    if (pending.request.kind === 'permission') permissions += 1;
    if (pending.request.kind === 'ask-user') questions += 1;
  }
  return permissions + questions === 0
    ? null
    : { turnId: turn.turnId, permissions, questions };
}

export function presentActivity({
  members,
  messageRunning,
  tail,
  incomplete,
  turnId,
  waiting,
}: {
  readonly members: readonly GroupCandidatePart[];
  readonly messageRunning: boolean;
  readonly tail: boolean;
  readonly incomplete: string | null;
  readonly turnId: string | null;
  readonly waiting: ProcessWaiting | null;
}) {
  const summary = summarizeActivityGroup(members);
  const summaryLabel = [summary.countsLabel, ...summary.resultFacts].filter(Boolean).join(' · ');
  const wait =
    incomplete === null && messageRunning && tail && waiting?.turnId === turnId
      ? waiting
      : null;
  const running =
    incomplete === null &&
    (summary.runningCount > 0 || (messageRunning && tail && wait === null));
  const active = members[activeActivityIndex(members)];
  const activeTool = active?.type === 'tool-call' ? readToolActivity(active) : null;
  let action: string;
  if (wait !== null) {
    action =
      wait.permissions > 0 && wait.questions > 0
        ? 'Waiting for confirmation and answers'
        : wait.questions > 0
          ? 'Waiting for answer'
          : 'Waiting for confirmation';
  } else if (running) {
    action = summary.runningCount > 0
      ? activeTool ? resolveToolAction(active?.toolName ?? '', activeTool.action) : 'Thinking'
      : 'Processing';
  } else {
    action = summary.toolCount === 0 ? 'Thought' : summaryLabel;
  }
  const facts: string[] = [];
  const failed = summary.failedCount > 0 || (tail && incomplete === 'error');
  if (summary.failedCount > 0) facts.push(`${summary.failedCount} failed`);
  else if (failed) facts.push('failed');
  if (summary.stoppedCount > 0 || (tail && incomplete === 'cancelled'))
    facts.push('stopped');
  if (summary.truncated) facts.push('reasoning truncated');
  if (summary.resultTruncatedCount > 0)
    facts.push(
      `${summary.resultTruncatedCount} result${summary.resultTruncatedCount === 1 ? '' : 's'} truncated`,
    );
  if (wait !== null && summary.runningToolCount > 0)
    facts.push(
      `${summary.runningToolCount} tool${summary.runningToolCount === 1 ? '' : 's'} running`,
    );
  else if (running && summary.runningToolCount > 1)
    facts.push(`${summary.runningToolCount - 1} other running`);
  return {
    running,
    action,
    summary: summaryLabel,
    target:
      running && wait === null && summary.runningCount > 0
        ? (activeTool?.target ?? null)
        : null,
    facts,
    failed,
  };
}
