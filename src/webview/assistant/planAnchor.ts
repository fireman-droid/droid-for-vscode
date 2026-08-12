import type { SessionTranscriptItem } from '../../shared/bridgeMessages';

export interface PlanStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Projection of one task plan for its anchor card in the transcript
 * (Cursor-style "Created Plan" card). The card renders at the
 * transcript position of the plan's first todowrite and shows the
 * plan's latest state; later todowrite rows update the card in place
 * and never spawn a new one. Derived purely from transcript tool
 * items (detailKind 'plan'); no new bridge data is involved.
 */
export interface PlanAnchorState {
  /** toolUseId of the todowrite row the card anchors to. */
  readonly anchorToolUseId: string;
  /**
   * Static card title: the opening step of the plan as first
   * written. Droid's todowrite carries no title field, so the first
   * step is the closest honest stand-in and it stays stable across
   * updates.
   */
  readonly title: string;
  /**
   * One quiet line under the title: the current step while it
   * differs from the title, otherwise the step count.
   */
  readonly summary: string;
  /** Latest version of the checklist. */
  readonly steps: readonly PlanStep[];
  readonly completedCount: number;
  readonly totalCount: number;
  /** In-progress step, falling back to the next pending one. */
  readonly currentText: string | null;
  readonly allCompleted: boolean;
}

/**
 * Parses the free-form todo text a task-plan tool wrote. The SDK
 * sends a numbered list where each line looks like
 * "1. [in_progress] Do the thing". Canonical parser shared by the
 * transcript checklist and the anchor card.
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
  readonly anchorToolUseId: string;
  readonly title: string;
  latestSteps: readonly PlanStep[];
}

/**
 * Groups the session's todowrites into plan lineages and projects
 * each lineage's latest state onto its anchor row (the lineage's
 * first todowrite). A later todowrite continues the current lineage
 * when it shares at least one step text with the lineage's latest
 * version — Droid rewrites the full list on every update, so
 * progress updates overlap heavily. A fully disjoint list reads as
 * a genuinely new plan and starts a new lineage with its own card.
 */
export function selectPlanAnchors(
  transcript: readonly SessionTranscriptItem[],
): ReadonlyMap<string, PlanAnchorState> {
  const lineages: PlanLineage[] = [];
  for (const item of transcript) {
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
    lineages.push({
      anchorToolUseId: item.toolUseId,
      title: firstLineOf(steps[0]?.text ?? ''),
      latestSteps: steps,
    });
  }

  const anchors = new Map<string, PlanAnchorState>();
  for (const lineage of lineages) {
    const steps = lineage.latestSteps;
    const completedCount = steps.filter(
      (step) => step.status === 'completed',
    ).length;
    const current =
      steps.find((step) => step.status === 'in_progress') ??
      steps.find((step) => step.status === 'pending');
    const currentText = current === undefined ? null : firstLineOf(current.text);
    anchors.set(lineage.anchorToolUseId, {
      anchorToolUseId: lineage.anchorToolUseId,
      title: lineage.title,
      summary:
        currentText !== null && currentText !== lineage.title
          ? currentText
          : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`,
      steps,
      completedCount,
      totalCount: steps.length,
      currentText,
      allCompleted: completedCount === steps.length,
    });
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
