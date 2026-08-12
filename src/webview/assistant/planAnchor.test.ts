import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import { parsePlanSteps, selectPlanAnchors } from './planAnchor';

function planTool(
  turnId: string,
  toolUseId: string,
  detail: string,
): SessionTranscriptItem {
  return {
    id: `tool:${turnId}:${toolUseId}`,
    kind: 'tool',
    turnId,
    toolUseId,
    toolName: 'TodoWrite',
    action: 'Updated the task plan',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    detailKind: 'plan',
    detail,
  };
}

function otherTool(turnId: string, toolUseId: string): SessionTranscriptItem {
  return {
    id: `tool:${turnId}:${toolUseId}`,
    kind: 'tool',
    turnId,
    toolUseId,
    toolName: 'Execute',
    action: 'Ran a command',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    detailKind: 'command',
    detail: 'pnpm test',
  };
}

const PLAN_V1 = [
  '1. [in_progress] Read the config',
  '2. [pending] Wire the selector',
  '3. [pending] Write the tests',
].join('\n');
const PLAN_V2 = [
  '1. [completed] Read the config',
  '2. [in_progress] Wire the selector',
  '3. [pending] Write the tests',
].join('\n');
const PLAN_V3 = [
  '1. [completed] Read the config',
  '2. [completed] Wire the selector',
  '3. [completed] Write the tests',
].join('\n');

describe('parsePlanSteps', () => {
  it('parses numbered status-labelled lines', () => {
    expect(parsePlanSteps(PLAN_V2)).toEqual([
      { status: 'completed', text: 'Read the config' },
      { status: 'in_progress', text: 'Wire the selector' },
      { status: 'pending', text: 'Write the tests' },
    ]);
  });

  it('treats unknown labels as pending and skips blank lines', () => {
    expect(
      parsePlanSteps('\n1. [someday] Later thing\n\n2. plain line\n'),
    ).toEqual([
      { status: 'pending', text: 'Later thing' },
      { status: 'pending', text: 'plain line' },
    ]);
  });

  it('returns nothing for unusable text', () => {
    expect(parsePlanSteps('   \n  ')).toEqual([]);
  });
});

describe('selectPlanAnchors', () => {
  it('returns an empty map when the transcript has no plan', () => {
    expect(
      selectPlanAnchors([
        { id: 'u1', kind: 'user', text: 'hello' },
        otherTool('turn-1', 'use-1'),
      ]).size,
    ).toBe(0);
  });

  it('anchors a single plan at its creation row', () => {
    const anchors = selectPlanAnchors([planTool('turn-1', 'use-1', PLAN_V2)]);
    expect([...anchors.keys()]).toEqual(['use-1']);
    expect(anchors.get('use-1')).toEqual({
      anchorToolUseId: 'use-1',
      title: 'Read the config',
      summary: 'Wire the selector',
      steps: [
        { status: 'completed', text: 'Read the config' },
        { status: 'in_progress', text: 'Wire the selector' },
        { status: 'pending', text: 'Write the tests' },
      ],
      completedCount: 1,
      totalCount: 3,
      currentText: 'Wire the selector',
      allCompleted: false,
    });
  });

  it('projects later updates onto the creation anchor in place', () => {
    const anchors = selectPlanAnchors([
      planTool('turn-1', 'use-1', PLAN_V1),
      otherTool('turn-1', 'use-2'),
      planTool('turn-1', 'use-3', PLAN_V2),
      planTool('turn-2', 'use-4', PLAN_V3),
    ]);
    expect([...anchors.keys()]).toEqual(['use-1']);
    const anchor = anchors.get('use-1');
    expect(anchor?.completedCount).toBe(3);
    expect(anchor?.allCompleted).toBe(true);
    expect(anchor?.currentText).toBeNull();
    // The title stays the plan's opening step as first written.
    expect(anchor?.title).toBe('Read the config');
  });

  it('summarizes with the step count when the current step is the title', () => {
    const anchors = selectPlanAnchors([planTool('turn-1', 'use-1', PLAN_V1)]);
    expect(anchors.get('use-1')?.summary).toBe('3 steps');
  });

  it('summarizes a finished plan with the step count', () => {
    const anchors = selectPlanAnchors([planTool('turn-1', 'use-1', PLAN_V3)]);
    expect(anchors.get('use-1')?.summary).toBe('3 steps');
  });

  it('starts a new lineage when an update shares no step text', () => {
    const anchors = selectPlanAnchors([
      planTool('turn-1', 'use-1', PLAN_V3),
      planTool('turn-2', 'use-9', '1. [in_progress] A wholly new mission'),
    ]);
    expect([...anchors.keys()]).toEqual(['use-1', 'use-9']);
    expect(anchors.get('use-1')?.allCompleted).toBe(true);
    expect(anchors.get('use-9')?.title).toBe('A wholly new mission');
    expect(anchors.get('use-9')?.summary).toBe('1 step');
  });

  it('continues the lineage on partial overlap (plan rewrite)', () => {
    const anchors = selectPlanAnchors([
      planTool('turn-1', 'use-1', PLAN_V1),
      planTool(
        'turn-1',
        'use-2',
        '1. [completed] Read the config\n2. [in_progress] A rewritten step',
      ),
    ]);
    expect([...anchors.keys()]).toEqual(['use-1']);
    expect(anchors.get('use-1')?.currentText).toBe('A rewritten step');
    expect(anchors.get('use-1')?.totalCount).toBe(2);
  });

  it('skips plan rows whose detail parses to no steps', () => {
    const anchors = selectPlanAnchors([
      planTool('turn-1', 'use-1', PLAN_V1),
      planTool('turn-2', 'use-2', '   '),
    ]);
    expect([...anchors.keys()]).toEqual(['use-1']);
    expect(anchors.get('use-1')?.totalCount).toBe(3);
  });
});
