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
 * state; later todowrite rows of the same lineage update the line in
 * place and never spawn a new one. Derived purely from transcript
 * tool items (detailKind 'plan'); no new bridge data is involved.
 */
export interface PlanAnchorState {
  /** toolUseId of the lineage's creation todowrite (stable key). */
  readonly anchorToolUseId: string;
  /**
   * Static line title: the opening step of the plan as first
   * written. Droid's todowrite carries no title field, so the first
   * step is the closest honest stand-in and it stays stable across
   * updates.
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
  readonly title: string;
  latestSteps: readonly PlanStep[];
}

/**
 * Groups the session's todowrites into plan lineages and projects
 * each lineage's latest state onto the user message that triggered
 * the turn the lineage was created in (map key: the user transcript
 * item's id, which doubles as the aui message id). A later todowrite
 * continues the current lineage when it shares at least one step
 * text with the lineage's latest version — Droid rewrites the full
 * list on every update, so progress updates overlap heavily. A fully
 * disjoint list reads as a genuinely new plan and starts a new
 * lineage with its own line. A plan with no preceding user message
 * has no anchor position and is skipped (fail quiet).
 */
export function selectPlanAnchors(
  transcript: readonly SessionTranscriptItem[],
): ReadonlyMap<string, readonly PlanAnchorState[]> {
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
    if (current !== undefined && sharesAnyStep(current.latestSteps, steps)) {
      current.latestSteps = steps;
      continue;
    }
    if (lastUserItemId === null) {
      continue;
    }
    lineages.push({
      anchorUserItemId: lastUserItemId,
      anchorToolUseId: item.toolUseId,
      title: firstLineOf(steps[0]?.text ?? ''),
      latestSteps: steps,
    });
  }

  const anchors = new Map<string, PlanAnchorState[]>();
  for (const lineage of lineages) {
    const steps = lineage.latestSteps;
    const completedCount = steps.filter(
      (step) => step.status === 'completed',
    ).length;
    const state: PlanAnchorState = {
      anchorToolUseId: lineage.anchorToolUseId,
      title: lineage.title,
      steps,
      completedCount,
      totalCount: steps.length,
      allCompleted: completedCount === steps.length,
    };
    const existing = anchors.get(lineage.anchorUserItemId);
    if (existing === undefined) {
      anchors.set(lineage.anchorUserItemId, [state]);
    } else {
      existing.push(state);
    }
  }
  return anchors;
}

function sharesAnyStep(
  previous: readonly PlanStep[],
  next: readonly PlanStep[],
): boolean {
  const seen = new Set(previous.map((step) => step.text));
  return next.some((step) => seen.has(step.text));
}

function firstLineOf(text: string): string {
  const index = text.indexOf('\n');
  return index === -1 ? text : text.slice(0, index);
}
