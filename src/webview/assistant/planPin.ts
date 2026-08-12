import type { SessionTranscriptItem } from '../../shared/bridgeMessages';

export interface PlanStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Projection of the session's current task plan for the pinned bar
 * above the Composer. Derived purely from transcript tool items
 * (detailKind 'plan'); no new bridge data is involved.
 */
export interface TaskPlanPinState {
  /** Stable identity of the plan row (`turnId:toolUseId`). */
  readonly planKey: string;
  readonly steps: readonly PlanStep[];
  readonly completedCount: number;
  readonly totalCount: number;
  /**
   * The step to headline while collapsed: the in-progress step, or
   * the next pending one right after a step completes. Null once
   * every step is completed.
   */
  readonly currentText: string | null;
  readonly allCompleted: boolean;
}

/**
 * Parses the free-form todo text a task-plan tool wrote. The SDK
 * sends a numbered list where each line looks like
 * "1. [in_progress] Do the thing". Canonical parser shared by the
 * transcript checklist and the pinned bar.
 */
export function parsePlanSteps(detail: string): readonly PlanStep[] {
  const steps: PlanStep[] = [];
  for (const rawLine of detail.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(?:\d+[.)]\s*)?\[([^\]]*)\]\s*(.*)$/u.exec(line);
    const label = match?.[1]?.toLowerCase().replace(/[\s_-]/gu, '') ?? '';
    const text = (match?.[2] ?? line.replace(/^\d+[.)]\s*/u, '')).trim();
    if (text.length === 0) {
      continue;
    }
    const status: PlanStep['status'] =
      label.includes('progress') || label === 'active' || label === 'doing'
        ? 'in_progress'
        : label.includes('complete') ||
            label.includes('done') ||
            label === 'x' ||
            label === 'checked'
          ? 'completed'
          : 'pending';
    steps.push({ status, text });
  }
  return steps;
}

/**
 * Projects the latest task plan of the session, or null when the
 * session never wrote one. Scans from the transcript tail so a
 * rewritten plan (a later todowrite in the same or a later turn)
 * supersedes earlier ones. Whether an all-completed plan is shown
 * briefly (live finish) or not at all (history replay) is the
 * component's call; the selector only reports the facts.
 */
export function selectTaskPlanPin(
  transcript: readonly SessionTranscriptItem[],
): TaskPlanPinState | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (
      item === undefined ||
      item.kind !== 'tool' ||
      item.detailKind !== 'plan' ||
      item.detail === undefined
    ) {
      continue;
    }
    const steps = parsePlanSteps(item.detail);
    if (steps.length === 0) {
      continue;
    }
    const completedCount = steps.filter(
      (step) => step.status === 'completed',
    ).length;
    const current =
      steps.find((step) => step.status === 'in_progress') ??
      steps.find((step) => step.status === 'pending');
    return {
      planKey: `${item.turnId}:${item.toolUseId}`,
      steps,
      completedCount,
      totalCount: steps.length,
      currentText: current?.text ?? null,
      allCompleted: completedCount === steps.length,
    };
  }
  return null;
}
