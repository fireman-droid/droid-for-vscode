import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import { parsePlanSteps, selectTaskPlanPin } from './planPin';

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

const ACTIVE_PLAN = [
  '1. [completed] Read the config',
  '2. [in_progress] Wire the selector',
  '3. [pending] Write the tests',
].join('\n');

describe('parsePlanSteps', () => {
  it('parses numbered status-labelled lines', () => {
    expect(parsePlanSteps(ACTIVE_PLAN)).toEqual([
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

describe('selectTaskPlanPin', () => {
  it('returns null when the transcript has no plan', () => {
    expect(
      selectTaskPlanPin([
        { id: 'u1', kind: 'user', text: 'hello' },
        otherTool('turn-1', 'use-1'),
      ]),
    ).toBeNull();
  });

  it('projects the plan with counts and the in-progress headline', () => {
    const pin = selectTaskPlanPin([planTool('turn-1', 'use-1', ACTIVE_PLAN)]);
    expect(pin).toEqual({
      planKey: 'turn-1:use-1',
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

  it('falls back to the next pending step when nothing is in progress', () => {
    const pin = selectTaskPlanPin([
      planTool(
        'turn-1',
        'use-1',
        '1. [completed] Done thing\n2. [pending] Next thing',
      ),
    ]);
    expect(pin?.currentText).toBe('Next thing');
  });

  it('reports a fully completed plan with a null headline', () => {
    const pin = selectTaskPlanPin([
      planTool('turn-1', 'use-1', '1. [completed] Only thing'),
    ]);
    expect(pin?.allCompleted).toBe(true);
    expect(pin?.currentText).toBeNull();
    expect(pin?.completedCount).toBe(1);
  });

  it('picks the latest plan when several were written', () => {
    const pin = selectTaskPlanPin([
      planTool('turn-1', 'use-1', '1. [pending] Old plan item'),
      otherTool('turn-2', 'use-2'),
      planTool('turn-2', 'use-3', '1. [in_progress] New plan item'),
    ]);
    expect(pin?.planKey).toBe('turn-2:use-3');
    expect(pin?.currentText).toBe('New plan item');
  });

  it('skips plan rows whose detail parses to no steps', () => {
    const pin = selectTaskPlanPin([
      planTool('turn-1', 'use-1', ACTIVE_PLAN),
      planTool('turn-2', 'use-2', '   '),
    ]);
    expect(pin?.planKey).toBe('turn-1:use-1');
  });
});
