import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import { parsePlanSteps, selectPlanAnchors } from './planAnchor';

function user(id: string, text = 'do the thing'): SessionTranscriptItem {
  return { id, kind: 'user', text };
}

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
      selectPlanAnchors([user('u1', 'hello'), otherTool('turn-1', 'use-1')])
        .size,
    ).toBe(0);
  });

  it('anchors a plan to the user message that triggered its turn', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V2),
    ]);
    expect([...anchors.keys()]).toEqual(['u1']);
    expect(anchors.get('u1')).toEqual([
      {
        anchorToolUseId: 'use-1',
        title: 'Wire the selector',
        steps: [
          { status: 'completed', text: 'Read the config' },
          { status: 'in_progress', text: 'Wire the selector' },
          { status: 'pending', text: 'Write the tests' },
        ],
        completedCount: 1,
        totalCount: 3,
        allCompleted: false,
      },
    ]);
  });

  it('skips a plan with no preceding user message (no anchor)', () => {
    const anchors = selectPlanAnchors([planTool('turn-1', 'use-1', PLAN_V1)]);
    expect(anchors.size).toBe(0);
  });

  it('projects later updates onto the creation anchor in place', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V1),
      otherTool('turn-1', 'use-2'),
      planTool('turn-1', 'use-3', PLAN_V2),
      user('u2'),
      planTool('turn-2', 'use-4', PLAN_V3),
    ]);
    // The overlapping turn-2 update continues the lineage anchored at
    // u1 — no second line under u2.
    expect([...anchors.keys()]).toEqual(['u1']);
    const anchor = anchors.get('u1')?.[0];
    expect(anchor?.anchorToolUseId).toBe('use-1');
    expect(anchor?.completedCount).toBe(3);
    expect(anchor?.allCompleted).toBe(true);
    // Once every step is done the title settles on the last step.
    expect(anchor?.title).toBe('Write the tests');
  });

  it('titles the line with the live step, the next pending one, or the last when done', () => {
    const titleOf = (detail: string) =>
      selectPlanAnchors([user('u1'), planTool('turn-1', 'use-1', detail)])
        .get('u1')?.[0]?.title;
    // Nothing started yet: the opening step is also the next one up.
    expect(titleOf('1. [pending] First\n2. [pending] Second')).toBe('First');
    // A running step always wins.
    expect(
      titleOf('1. [completed] First\n2. [in_progress] Second\n3. [pending] Third'),
    ).toBe('Second');
    // Between updates (nothing in progress) the frontier pending step leads.
    expect(titleOf('1. [completed] First\n2. [pending] Second')).toBe('Second');
    // Fully done: the last step, not the first.
    expect(titleOf('1. [completed] First\n2. [completed] Second')).toBe('Second');
    expect(
      titleOf('1. [completed] First\n2. [completed] Second\n3. [completed] Third'),
    ).toBe('Third');
  });

  it('starts a new lineage when an update shares no step text', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V3),
      user('u2'),
      planTool('turn-2', 'use-9', '1. [in_progress] A wholly new mission'),
    ]);
    expect([...anchors.keys()]).toEqual(['u1', 'u2']);
    expect(anchors.get('u1')?.[0]?.allCompleted).toBe(true);
    expect(anchors.get('u2')?.[0]?.title).toBe('A wholly new mission');
  });

  it('stacks two disjoint lineages of one turn under the same message', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V3),
      planTool('turn-1', 'use-2', '1. [in_progress] A wholly new mission'),
    ]);
    expect([...anchors.keys()]).toEqual(['u1']);
    expect(
      anchors.get('u1')?.map((anchor) => anchor.anchorToolUseId),
    ).toEqual(['use-1', 'use-2']);
  });

  it('continues the lineage on partial overlap (plan rewrite)', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V1),
      planTool(
        'turn-1',
        'use-2',
        '1. [completed] Read the config\n2. [in_progress] A rewritten step',
      ),
    ]);
    expect([...anchors.keys()]).toEqual(['u1']);
    expect(anchors.get('u1')?.[0]?.totalCount).toBe(2);
    expect(anchors.get('u1')?.[0]?.steps[1]?.text).toBe('A rewritten step');
  });

  it('skips plan rows whose detail parses to no steps', () => {
    const anchors = selectPlanAnchors([
      user('u1'),
      planTool('turn-1', 'use-1', PLAN_V1),
      planTool('turn-2', 'use-2', '   '),
    ]);
    expect([...anchors.keys()]).toEqual(['u1']);
    expect(anchors.get('u1')?.[0]?.totalCount).toBe(3);
  });
});
