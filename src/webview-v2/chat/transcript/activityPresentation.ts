import { translate, type Translate } from '@droidvisx/chat-ui/i18n';
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
  t = (message, params) => translate('en', message, params),
}: {
  readonly members: readonly GroupCandidatePart[];
  readonly messageRunning: boolean;
  readonly tail: boolean;
  readonly incomplete: string | null;
  readonly turnId: string | null;
  readonly waiting: ProcessWaiting | null;
  readonly t?: Translate;
}) {
  const summary = summarizeActivityGroup(members, t);
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
    action = summary.toolCount === 0 ? 'Thought' : summary.compactLabel;
  }
  const facts: string[] = [];
  const detailFacts = [...summary.resultFacts];
  const failed = summary.failedCount > 0 || (tail && incomplete === 'error');
  if (summary.failedCount > 0) facts.push(t('{count} failed', { count: summary.failedCount }));
  else if (failed) facts.push(t('failed'));
  if (summary.stoppedCount > 0 || (tail && incomplete === 'cancelled'))
    facts.push(t('stopped'));
  if (summary.truncated) detailFacts.push(t('reasoning truncated'));
  if (summary.resultTruncatedCount > 0)
    detailFacts.push(
      t(summary.resultTruncatedCount === 1 ? '{count} result truncated' : '{count} results truncated', { count: summary.resultTruncatedCount }),
    );
  if (wait !== null && summary.runningToolCount > 0)
    facts.push(
      t(summary.runningToolCount === 1 ? '{count} tool running' : '{count} tools running', { count: summary.runningToolCount }),
    );
  else if (running) {
    const latest = members.at(-1);
    const latestStatus = latest?.type === 'tool-call' ? readToolActivity(latest).status : null;
    const otherRunning = summary.runningToolCount - (latestStatus === 'running' || latestStatus === 'stopping' ? 1 : 0);
    if (otherRunning > 0) facts.push(t('{count} other running', { count: otherRunning }));
  }
  return {
    running,
    waiting: wait !== null,
    action,
    summary: summaryLabel,
    target:
      running && wait === null && summary.runningCount > 0
        ? (activeTool?.target ?? null)
        : null,
    facts,
    detailFacts,
    failed,
  };
}
