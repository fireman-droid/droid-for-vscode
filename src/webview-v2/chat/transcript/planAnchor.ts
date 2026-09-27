import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';

export interface PlanStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Projection of a task-plan lineage. Its thin line
 * renders under the user message that created that lineage and shows
 * its latest state. Older lineages remain with their original messages. Derived
 * purely from transcript tool items (detailKind 'plan'); no new
 * bridge data is involved.
 */
export interface PlanAnchorState {
  /** toolUseId of the lineage's creation todowrite (stable key). */
  readonly anchorToolUseId: string;
  /**
   * Turn of the latest TodoWrite snapshot. Live styling is scoped to
   * this turn so a later unrelated response cannot wake an older
   * unfinished plan.
   */
  readonly latestTurnId: string;
  /**
   * Status-line title: the step Droid is on right now (first
   * in_progress), else the next pending step, else the last step
   * once everything is done — so the collapsed line reads as live
   * progress next to its n/m count. Droid's todowrite carries no
   * plan-title field, so step text is the only honest source.
   */
  readonly title: string;
  /** Latest version of the checklist. */
  readonly steps: readonly PlanStep[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly allCompleted: boolean;
}

/**
 * Parses the free-form todo text a task-plan tool wrote. The SDK
 * sends a numbered list where each line looks like
 * "1. [in_progress] Do the thing". Canonical parser shared by the
 * transcript checklist and the plan line.
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

interface PlanLineage {
  /** Transcript item id of the user message that triggered the turn. */
  readonly anchorUserItemId: string;
  readonly anchorToolUseId: string;
  latestTurnId: string;
  latestSteps: readonly PlanStep[];
}

/**
 * Projects the latest Plan lineage for each originating user message (map key:
 * that transcript item id, which doubles as the aui message id).
 * Later TodoWrites update the current lineage in place. Across user
 * anchors, overlap continues an unfinished lineage; a completed
 * lineage or a disjoint list starts a new plan. Completed and superseded
 * plans remain in history; a new lineage under the same message replaces
 * that message's previous card. A plan with no preceding
 * user message has no anchor position and is skipped (fail quiet).
 */
export function selectPlanAnchors(
  transcript: readonly SessionTranscriptItem[],
): ReadonlyMap<string, PlanAnchorState> {
  let current: PlanLineage | null = null;
  const lineages = new Map<string, PlanLineage>();
  let lastUserItemId: string | null = null;
  for (const item of transcript) {
    if (item.kind === 'user') {
      lastUserItemId = item.id;
      continue;
    }
    if (
      item.kind !== 'tool' ||
      item.detailKind !== 'plan' ||
      item.detail === undefined ||
      item.status === 'failed'
    ) {
      continue;
    }
    const steps = parsePlanSteps(item.detail);
    if (steps.length === 0) {
      continue;
    }
    if (current !== null) {
      const sameAnchor = current.anchorUserItemId === lastUserItemId;
      const sharesCurrent = sharesAnyStep(current.latestSteps, steps);
      const unfinished = !planCompleted(current.latestSteps);
      const continues = unfinished
        ? sameAnchor || sharesCurrent
        : sameAnchor && sharesCurrent;
      if (continues) {
        current.latestTurnId = item.turnId;
        current.latestSteps = steps;
        continue;
      }
    }
    if (lastUserItemId === null) {
      continue;
    }
    current = {
      anchorUserItemId: lastUserItemId,
      anchorToolUseId: item.toolUseId,
      latestTurnId: item.turnId,
      latestSteps: steps,
    };
    lineages.set(lastUserItemId, current);
  }

  const anchors = new Map<string, PlanAnchorState>();
  for (const lineage of lineages.values()) {
    const steps = lineage.latestSteps;
    const completedCount = steps.filter((step) => step.status === 'completed').length;
    anchors.set(lineage.anchorUserItemId, {
      anchorToolUseId: lineage.anchorToolUseId,
      latestTurnId: lineage.latestTurnId,
      title: planLineTitle(steps),
      steps,
      completedCount,
      totalCount: steps.length,
      allCompleted: completedCount === steps.length,
    });
  }
  return anchors;
}

function planCompleted(steps: readonly PlanStep[]): boolean {
  return steps.every((step) => step.status === 'completed');
}

function sharesAnyStep(
  previous: readonly PlanStep[],
  next: readonly PlanStep[],
): boolean {
  const seen = new Set(previous.map((step) => step.text));
  return next.some((step) => seen.has(step.text));
}

/** Current-step stand-in title (see PlanAnchorState.title). */
function planLineTitle(steps: readonly PlanStep[]): string {
  const current =
    steps.find((step) => step.status === 'in_progress') ??
    steps.find((step) => step.status === 'pending') ??
    steps[steps.length - 1];
  return firstLineOf(current?.text ?? '');
}

function firstLineOf(text: string): string {
  const index = text.indexOf('\n');
  return index === -1 ? text : text.slice(0, index);
}

/** A Plan animates only while the turn that last updated it is active. */
export function isPlanLive(
  anchor: PlanAnchorState,
  running: boolean,
  activeTurnId: string | null,
): boolean {
  return running && activeTurnId !== null && anchor.latestTurnId === activeTurnId;
}
