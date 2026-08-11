import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_GROUP_KEY,
  activityGroupBy,
  classifyExploreTool,
  isSwallowableReasoning,
  MAX_SWALLOWED_REASONING_CHARS,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from './activityGrouping';

function tool(
  toolName: string,
  metadata: {
    status?: string;
    durationMs?: number;
    filePath?: string;
  } = {},
): GroupCandidatePart {
  return {
    type: 'tool-call',
    toolName,
    providerMetadata: {
      droidvisx: {
        status: metadata.status ?? 'completed',
        durationMs: metadata.durationMs ?? null,
        filePath: metadata.filePath ?? null,
      },
    },
  };
}

function reasoning(
  text: string,
  statusType = 'complete',
): GroupCandidatePart {
  return { type: 'reasoning', text, status: { type: statusType } };
}

describe('classifyExploreTool', () => {
  it('maps every exploration tool to its semantic category', () => {
    expect(classifyExploreTool('Read')).toBe('file');
    expect(classifyExploreTool('Grep')).toBe('search');
    expect(classifyExploreTool('Glob')).toBe('search');
    expect(classifyExploreTool('WebSearch')).toBe('search');
    expect(classifyExploreTool('LS')).toBe('folder');
    expect(classifyExploreTool('FetchUrl')).toBe('fetch');
    expect(classifyExploreTool('TaskOutput')).toBe('task-check');
    expect(classifyExploreTool('Skill')).toBe('skill');
  });

  it('matches namespaced tool names through the leaf candidate', () => {
    expect(classifyExploreTool('workspace.read')).toBe('file');
    expect(classifyExploreTool('tools/grep')).toBe('search');
  });

  it('keeps commands, edits, plans and interactions ungroupable', () => {
    expect(classifyExploreTool('Execute')).toBeNull();
    expect(classifyExploreTool('Edit')).toBeNull();
    expect(classifyExploreTool('Write')).toBeNull();
    expect(classifyExploreTool('Create')).toBeNull();
    expect(classifyExploreTool('ApplyPatch')).toBeNull();
    expect(classifyExploreTool('TodoWrite')).toBeNull();
    expect(classifyExploreTool('AskUser')).toBeNull();
    expect(classifyExploreTool('ExitSpecMode')).toBeNull();
    expect(classifyExploreTool('Task')).toBeNull();
    expect(classifyExploreTool('SomeUnknownTool')).toBeNull();
  });
});

describe('isSwallowableReasoning', () => {
  it('accepts short reasoning and rejects long or multi-line text', () => {
    expect(isSwallowableReasoning('Quick check of the imports.')).toBe(
      true,
    );
    expect(
      isSwallowableReasoning('a'.repeat(MAX_SWALLOWED_REASONING_CHARS)),
    ).toBe(true);
    expect(
      isSwallowableReasoning(
        'a'.repeat(MAX_SWALLOWED_REASONING_CHARS + 1),
      ),
    ).toBe(false);
    expect(isSwallowableReasoning('one\ntwo')).toBe(true);
    expect(isSwallowableReasoning('one\ntwo\nthree')).toBe(false);
  });
});

describe('activityGroupBy', () => {
  it('groups exploration tool calls only', () => {
    expect(activityGroupBy(tool('Read'))).toEqual([ACTIVITY_GROUP_KEY]);
    expect(activityGroupBy(tool('Grep'))).toEqual([ACTIVITY_GROUP_KEY]);
    expect(activityGroupBy(tool('Execute'))).toBeNull();
    expect(activityGroupBy(tool('Edit'))).toBeNull();
    expect(activityGroupBy(tool('TodoWrite'))).toBeNull();
  });

  it('swallows short reasoning and splits on long reasoning', () => {
    expect(activityGroupBy(reasoning('Short thought.'))).toEqual([
      ACTIVITY_GROUP_KEY,
    ]);
    expect(
      activityGroupBy(reasoning('x'.repeat(500))),
    ).toBeNull();
  });

  it('splits on text and data parts', () => {
    expect(
      activityGroupBy({ type: 'text', text: 'short answer' }),
    ).toBeNull();
    expect(activityGroupBy({ type: 'data' })).toBeNull();
  });

  it('returns a stable path identity for memoized regrouping', () => {
    expect(activityGroupBy(tool('Read'))).toBe(
      activityGroupBy(tool('Grep')),
    );
  });
});

describe('summarizeActivityGroup', () => {
  it('renders as a group from three tools and quantifies by category', () => {
    const summary = summarizeActivityGroup([
      tool('Read', { durationMs: 200 }),
      tool('Read', { durationMs: 300 }),
      tool('Read'),
      tool('Grep', { durationMs: 3_600 }),
      tool('WebSearch'),
      tool('LS'),
      tool('FetchUrl'),
      tool('TaskOutput'),
      tool('Skill'),
    ]);
    expect(summary.renderAsGroup).toBe(true);
    expect(summary.toolCount).toBe(9);
    expect(summary.countsLabel).toBe(
      '3 files, 2 searches, 1 folder, 1 fetch, 1 task check, 1 skill',
    );
    expect(summary.durationMs).toBe(4_100);
    expect(summary.anyRunning).toBe(false);
    expect(summary.failedCount).toBe(0);
  });

  it('stays below the batch threshold for one or two tools', () => {
    expect(summarizeActivityGroup([tool('Read')]).renderAsGroup).toBe(
      false,
    );
    expect(
      summarizeActivityGroup([tool('Read'), tool('Grep')])
        .renderAsGroup,
    ).toBe(false);
  });

  it('counts swallowed thinking toward the step threshold but never forms an all-thinking group', () => {
    expect(
      summarizeActivityGroup([
        tool('Read'),
        reasoning('Quick check.'),
        tool('Grep'),
      ]).renderAsGroup,
    ).toBe(true);
    expect(
      summarizeActivityGroup([
        reasoning('One.'),
        reasoning('Two.'),
        tool('Read'),
      ]).renderAsGroup,
    ).toBe(false);
  });

  it('reports running while any member is live, including streaming reasoning', () => {
    expect(
      summarizeActivityGroup([
        tool('Read'),
        tool('Grep', { status: 'running' }),
        tool('Read'),
      ]).anyRunning,
    ).toBe(true);
    expect(
      summarizeActivityGroup([
        tool('Read'),
        reasoning('Thinking…', 'running'),
        tool('Grep'),
      ]).anyRunning,
    ).toBe(true);
  });

  it('sums only reported durations and surfaces failures and stops', () => {
    const summary = summarizeActivityGroup([
      tool('Read', { durationMs: 100 }),
      tool('Read', { status: 'failed' }),
      tool('Grep', { status: 'stopped', durationMs: 50 }),
    ]);
    expect(summary.durationMs).toBe(150);
    expect(summary.failedCount).toBe(1);
    expect(summary.stoppedCount).toBe(1);

    expect(
      summarizeActivityGroup([tool('Read'), tool('Read'), tool('Read')])
        .durationMs,
    ).toBeNull();
  });

  it('dedupes read file paths and shows a single known file by name', () => {
    const summary = summarizeActivityGroup([
      tool('Read', { filePath: 'src/app/main.ts' }),
      tool('Read', { filePath: 'src/app/main.ts' }),
      tool('Grep'),
      tool('Grep'),
    ]);
    expect(summary.countsLabel).toBe('main.ts, 2 searches');
  });

  it('keeps plural file counts when paths are unknown', () => {
    const summary = summarizeActivityGroup([
      tool('Read'),
      tool('Read'),
      tool('Grep'),
    ]);
    expect(summary.countsLabel).toBe('2 files, 1 search');
  });
});
