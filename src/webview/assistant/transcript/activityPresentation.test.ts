import { describe, expect, it } from 'vitest';
import {
  activityGroupBy,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from './activityGrouping';
import { currentProcessWaiting, presentActivity } from './activityPresentation';

const tool = (
  name = 'Read',
  status = 'completed',
  extra: Record<string, unknown> = {},
): GroupCandidatePart => ({
  type: 'tool-call',
  toolName: name,
  providerMetadata: {
    droidvisx: {
      action: `Run ${name}`,
      status,
      progressCount: 0,
      latestUpdateKind: null,
      target: 'app.ts',
      ...extra,
    },
  },
});
const thinking = (status = 'running'): GroupCandidatePart => ({
  type: 'reasoning',
  text: '',
  status: { type: status },
});
const present = (
  members: readonly GroupCandidatePart[],
  overrides: Partial<Parameters<typeof presentActivity>[0]> = {},
) =>
  presentActivity({
    members,
    messageRunning: false,
    tail: true,
    incomplete: null,
    turnId: 'turn-1',
    waiting: null,
    ...overrides,
  });

describe('Activity state and grouping', () => {
  it('names browser actions in old records and keeps their failures visible in the settled summary', () => {
    const snapshot = tool('browser_snapshot', 'completed', { action: 'Verified the interface', target: undefined });
    const click = tool('browser_click', 'running', { action: 'Verified the interface', target: undefined });
    expect(present([snapshot, click], { messageRunning: true })).toMatchObject({
      action: 'Click element', target: null, running: true, summary: 'Inspect page, Click element',
    });
    const failed = tool('browser_click', 'failed', { action: 'Verified the interface', target: undefined });
    expect(present([snapshot, failed])).toMatchObject({
      action: 'Inspect page, Click element', facts: ['1 failed'], running: false,
    });
  });

  it('includes commands and unknown tools in mixed activity summaries', () => {
    const result = present([tool('Read'), tool('Execute', 'completed', { action: 'Ran a local command' }),
      tool('mcp__design__measure_layout', 'completed', { action: undefined })]);
    expect(result.summary).toBe('1 read, Run command, Measure layout');
    expect(result.action).toBe(result.summary);
  });

  it('retains specific actions extracted from browser input in the group summary', () => {
    const result = present([
      tool('browser_action', 'completed', { action: 'Click element' }),
      tool('browser_action', 'completed', { action: 'Click element' }),
      tool('browser_action', 'completed', { action: 'Scroll page' }),
    ]);
    expect(result.summary).toBe('Click element × 2, Scroll page');
  });

  it('counts repeated Read calls rather than guessed distinct files and keeps grouping boundaries', () => {
    const parts = [
      thinking('complete'),
      tool('Read', 'completed', { filePath: 'app.ts' }),
      tool('Read', 'completed', { filePath: 'app.ts' }),
      tool('Grep'),
    ];
    expect(summarizeActivityGroup(parts)).toMatchObject({
      toolCount: 3,
      countsLabel: '2 reads, 1 search',
    });
    expect(activityGroupBy(parts[0]!)).toBe(
      activityGroupBy({ ...parts[0]!, text: 'More thinking' }),
    );
    for (const part of [
      { type: 'text' },
      { type: 'image' },
      { type: 'data' },
      tool('Execute'),
      tool('Edit'),
      tool('AskUser'),
      tool('Task'),
    ]) {
      expect(activityGroupBy(part)).toBeNull();
    }
    expect(present(parts).action).toBe('2 reads, 1 search');
  });

  it('scopes pending interactions to the current session and active turn', () => {
    const waiting = currentProcessWaiting(
      'session-1',
      { turnId: 'turn-1', status: 'streaming' },
      [
        { sessionId: 'other', turnId: 'turn-1', request: { kind: 'ask-user' } },
        { sessionId: 'session-1', turnId: 'old-turn', request: { kind: 'ask-user' } },
        { sessionId: 'session-1', turnId: 'turn-1', request: { kind: 'permission' } },
      ],
    );
    expect(waiting).toEqual({ turnId: 'turn-1', permissions: 1, questions: 0 });
    expect(present([tool()], { messageRunning: true, waiting })).toMatchObject({
      action: 'Waiting for confirmation',
      running: false,
    });
    expect(present([tool()], { messageRunning: true, waiting, tail: false }).action).toBe(
      '1 read',
    );
    expect(
      present([tool()], { messageRunning: true, waiting, turnId: 'old-turn' }).action,
    ).toBe('Processing');
    expect(
      currentProcessWaiting('session-1', { turnId: 'turn-1', status: 'stopping' }, [
        { sessionId: 'session-1', turnId: 'turn-1', request: { kind: 'permission' } },
      ]),
    ).toBeNull();
  });

  it('keeps parallel tools visible while waiting for an answer without claiming the whole group paused', () => {
    const view = present([tool('Read', 'running'), tool('Grep', 'running')], {
      messageRunning: true,
      waiting: { turnId: 'turn-1', permissions: 0, questions: 1 },
    });
    expect(view).toMatchObject({
      action: 'Waiting for answer',
      running: true,
      target: null,
    });
    expect(view.facts).toContain('2 tools running');
  });

  it('uses actual active thinking and neutral processing instead of inferring a model wait', () => {
    expect(present([thinking()], { messageRunning: true }).action).toBe('Thinking');
    expect(present([thinking('complete'), tool()], { messageRunning: true }).action).toBe(
      'Processing',
    );
    expect(present([tool('Read', 'running')], { messageRunning: true })).toMatchObject({
      action: 'Run Read',
      target: 'app.ts',
      running: true,
    });
  });

  it('preserves failure, stop and snippet truncation facts after completion and stops animation', () => {
    const view = present([
      tool('Read', 'failed'),
      tool('Grep', 'completed', {
        resultPreview: {
          availability: 'available',
          text: 'some matches',
          source: { tool: 'Grep', path: '.', callId: 'grep-1' },
          truncated: true,
        },
      }),
    ]);
    expect(view.action).toBe('1 read, 1 search');
    expect(view.facts).toEqual(['1 failed', '1 result truncated']);
    const stopped = present([tool('Read', 'running')], { incomplete: 'cancelled' });
    expect(stopped.running).toBe(false);
    expect(stopped.facts).toContain('stopped');
  });
});
