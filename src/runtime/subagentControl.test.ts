import { describe, expect, it, vi } from 'vitest';

import {
  createDaemonSubagentControl,
  projectSubagentActivities,
} from './subagentControl';
import { readSubagentInvocationRecords } from './subagentSummary';

describe('projectSubagentActivities', () => {
  it('returns the latest semantic activity and three preceding activities', () => {
    expect(
      projectSubagentActivities([
        {
          content: [
            {
              type: 'tool_use',
              name: 'Skill',
              input: { skill: 'frontend-design' },
            },
            { type: 'text', text: 'hi' },
          ],
        },
        {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'd:/work/src/app.ts' },
            },
            {
              type: 'tool_use',
              name: 'Grep',
              input: { pattern: 'SSE', path: 'd:/work/src' },
            },
          ],
        },
        {
          content: [
            {
              type: 'tool_use',
              name: 'Execute',
              input: { command: 'pnpm exec vitest run app.test.ts' },
            },
          ],
        },
        { content: [{ type: 'text', text: 'done' }] },
      ], 'd:/work'),
    ).toEqual([
      { action: 'Ran a local command', target: 'Tests' },
      {
        action: 'Searched workspace content',
        target: 'SSE · src',
      },
      { action: 'Read workspace files', target: 'src/app.ts' },
      {
        action: 'Loaded workflow guidance',
        target: 'frontend-design',
      },
    ]);
  });

  it('deduplicates adjacent activities and strips unsafe detail', () => {
    expect(
      projectSubagentActivities([
        {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'd:/outside/secret.txt' },
            },
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'd:/outside/secret.txt' },
            },
            {
              type: 'tool_use',
              name: `  Weird${'\u0000'}Tool\n `,
              input: { secret: 'RAW_INPUT_SECRET' },
            },
          ],
        },
      ], 'd:/work'),
    ).toEqual([
      { action: 'Continued delegated work', target: null },
      { action: 'Read workspace files', target: null },
    ]);
    expect(
      projectSubagentActivities([
        { content: [{ type: 'tool_use', name: '\u0007\u0000' }] },
        'not-a-message',
        { content: 'not-an-array' },
      ], 'd:/work'),
    ).toEqual([]);
    expect(projectSubagentActivities('nope', 'd:/work')).toEqual([]);
  });

  it('projects changed files and the current plan item without raw input', () => {
    expect(
      projectSubagentActivities([
        {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: 'd:/work/src/app.ts',
                secret: 'RAW_INPUT_SECRET',
              },
            },
            {
              type: 'tool_use',
              name: 'TodoWrite',
              input: {
                todos:
                  '1. [completed] Inspect code\n' +
                  '2. [in_progress] Implement semantic activity',
              },
            },
          ],
        },
      ], 'd:/work'),
    ).toEqual([
      {
        action: 'Updated the task plan',
        target: 'Implement semantic activity',
      },
      {
        action: 'Updated workspace files',
        target: 'src/app.ts',
      },
    ]);
  });
});

describe('createDaemonSubagentControl', () => {
  it('samples activity through sessions.getMessages', async () => {
    const getMessages = vi.fn().mockResolvedValue([
      {
        content: [
          {
            type: 'tool_use',
            name: 'Glob',
            input: { patterns: '**/*.ts', folder: 'd:/work/src' },
          },
        ],
      },
    ]);
    const gateway = createDaemonSubagentControl(async () =>
      ({ sessions: { getMessages } }) as never,
    );
    await expect(
      gateway.sampleActivities('child-1', 'd:/work'),
    ).resolves.toEqual([
      {
        action: 'Inspected workspace structure',
        target: '**/*.ts · src',
      },
    ]);
    expect(getMessages).toHaveBeenCalledWith('child-1', { limit: 40 });
  });

  it('reports failure without throwing when the daemon path breaks', async () => {
    const gateway = createDaemonSubagentControl(async () => {
      throw new Error('daemon down');
    });
    await expect(
      gateway.sampleActivities('child-3', 'd:/work'),
    ).resolves.toEqual([]);
  });
});

describe('readSubagentInvocationRecords', () => {
  const envelope = (invocations: unknown) => ({
    result: { subagentInvocations: invocations },
  });

  it('keeps the child session id host-side and strips it bridge-side', () => {
    const records = readSubagentInvocationRecords(
      envelope([
        {
          childSessionId: 'child-1',
          subagentType: 'explore',
          description: 'map the flow',
          status: 'running',
        },
        {
          childSessionId: { hostile: true },
          subagentType: 'explore',
          description: 'no id',
          status: 'completed',
          toolUseCount: 3,
          durationMs: 900,
        },
      ]),
    );
    expect(records).toEqual([
      {
        summary: {
          type: 'explore',
          description: 'map the flow',
          status: 'running',
        },
        childSessionId: 'child-1',
      },
      {
        summary: {
          type: 'explore',
          description: 'no id',
          status: 'completed',
          toolUseCount: 3,
          durationMs: 900,
        },
        childSessionId: null,
      },
    ]);
    // The bridge-safe view never carries an id-shaped key.
    for (const record of records) {
      expect('childSessionId' in record.summary).toBe(false);
    }
  });

  it('rejects unprintable child ids instead of passing them through', () => {
    const [record] = readSubagentInvocationRecords(
      envelope([
        {
          childSessionId: 'evil\u0000id',
          subagentType: 'explore',
          description: '',
          status: 'completed',
        },
      ]),
    );
    expect(record?.childSessionId).toBeNull();
  });
});
