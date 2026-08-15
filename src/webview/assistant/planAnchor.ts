import type { SessionTranscriptItem } from '../../shared/bridgeMessages';

export interface PlanStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Projection of one task plan for its thin plan line in the
 * transcript. The line renders directly under the user message that
 * triggered the turn in which the plan was created (the first
 * element of that turn's reply area) and shows the plan's latest
 * state; later todowrite rows anchored to that same user message
 * always replace the line in place, even when Droid rewrites every
 * step. Derived purely from transcript tool items (detailKind
 * 'plan'); no new bridge data is involved.
 */
export interface PlanAnchorState {
  /** toolUseId of the lineage's creation todowrite (stable key). */
  readonly anchorToolUseId: string;
  /**
   * Status-line title: the step Droid is on right now (first
   * in_progress), else the next pending step, else the last step
   * once everything is done — so the collapsed line reads as live
   * progress next to its n/m count. Droid's todowrite carries no
   * plan-title field, so step text is the only honest source; the
   * gap and its upstream fix paths are recorded in
   * docs/product/plan-title-limitation.md.
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
  latestSteps: readonly PlanStep[];
}

/**
 * Groups the session's todowrites into plan lineages and projects
 * each lineage's latest state onto the user message that triggered
 * the turn the lineage was created in (map key: the user transcript
 * item's id, which doubles as the aui message id). Every anchor owns
 * at most one visible plan: a later todowrite under the same anchor
 * updates it even after a complete rewrite. Across user anchors,
 * overlap continues an unfinished lineage; a completed lineage or a
 * disjoint list starts a genuinely new plan. A plan with no preceding
 * user message has no anchor position and is skipped (fail quiet).
 */
export function selectPlanAnchors(
  transcript: readonly SessionTranscriptItem[],
): ReadonlyMap<string, PlanAnchorState> {
  const lineages: PlanLineage[] = [];
  let lastUserItemId: string | null = null;
  for (const item of transcript) {
    if (item.kind === 'user') {
      lastUserItemId = item.id;
      continue;
    }
    if (
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
    const current = lineages[lineages.length - 1];
    const sameAnchor =
      current?.anchorUserItemId === lastUserItemId;
    const continuesUnfinished =
      current !== undefined &&
      !planCompleted(current.latestSteps) &&
      sharesAnyStep(current.latestSteps, steps);
    if (current !== undefined && (sameAnchor || continuesUnfinished)) {
      current.latestSteps = steps;
      continue;
    }
    if (lastUserItemId === null) {
      continue;
    }
    lineages.push({
      anchorUserItemId: lastUserItemId,
      anchorToolUseId: item.toolUseId,
      latestSteps: steps,
    });
  }

  const anchors = new Map<string, PlanAnchorState>();
  for (const lineage of lineages) {
    const steps = lineage.latestSteps;
    const completedCount = steps.filter(
      (step) => step.status === 'completed',
    ).length;
    const state: PlanAnchorState = {
      anchorToolUseId: lineage.anchorToolUseId,
      title: planLineTitle(steps),
      steps,
      completedCount,
      totalCount: steps.length,
      allCompleted: completedCount === steps.length,
    };
    anchors.set(lineage.anchorUserItemId, state);
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
