import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import {
  MAX_TOOL_RESULT_LINES,
  MAX_TOOL_RESULT_TEXT_UNITS,
  isToolResultPreview,
} from '../../shared/transcript/toolResultPreview';
import {
  createToolResultCollector,
  extractResultPreview,
  readResultSource,
} from './toolResultPreview';
import { projectSessionMessages } from '../history/projectSessionHistory';

const root = resolve('preview-workspace');
const source = { tool: 'Read' as const, path: 'src/app.ts', callId: 'read-1' };
const call: DroidStreamEvent = {
  type: 'tool_call',
  name: 'Read',
  toolUseId: 'read-1',
  input: { file_path: resolve(root, 'src/app.ts') },
};
const result: DroidStreamEvent = {
  type: 'tool_result',
  toolName: 'Read',
  toolUseId: 'read-1',
  isError: false,
  content: 'export const value = 1;',
};

describe('bounded native tool result extraction', () => {
  it('uses actual complete call input and produces the same snippet in live and history paths', () => {
    const collect = createToolResultCollector(root);
    collect(call);
    const live = collect(result);
    expect(live).toEqual({
      availability: 'available',
      source,
      text: result.content,
      truncated: false,
    });
    const history = projectSessionMessages(
      [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Read the app' }] },
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: call.input }],
        },
        {
          id: 't1',
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'read-1',
              content: result.content,
              isError: false,
            },
          ],
        },
      ],
      { workspaceRoot: root },
    );
    expect(history.status).toBe('available');
    if (history.status !== 'available') throw new Error('History projection failed');
    const tool = history.state.transcript.find((item) => item.kind === 'tool');
    expect(tool?.kind === 'tool' && tool.resultPreview).toEqual(live);
  });

  it('does not trust third-party leaf names, missing starts, or another invocation name', () => {
    const collect = createToolResultCollector(root);
    collect({ ...call, name: 'mcp__example__Read' });
    expect(collect({ ...result, toolName: 'mcp__example__Read' })).toBeUndefined();
    expect(collect(result)).toEqual({ availability: 'unavailable', reason: 'untrusted' });
    collect(call);
    expect(collect({ ...result, toolName: 'Grep' })).toEqual({
      availability: 'unavailable',
      reason: 'untrusted',
    });
    expect(createToolResultCollector(root)(result)).toEqual({
      availability: 'unavailable',
      reason: 'untrusted',
    });
  });

  it.each([['.env', 'restricted'], ['.ssh/id_ed25519', 'restricted'], ['.npmrc', 'restricted'], ['../outside.txt', 'outside-workspace']])(
    'does not expose unavailable source %s',
    (path, reason) => {
      expect(
        readResultSource('Read', { file_path: resolve(root, path) }, root, 'read-1'),
      ).toBe(reason);
    },
  );

  it('uses the workspace default for directory tools but never invents a missing Read source', () => {
    expect(readResultSource('Grep', { pattern: 'TODO' }, root, 'grep-1')).toEqual({
      tool: 'Grep',
      path: '.',
      callId: 'grep-1',
    });
    expect(readResultSource('Read', {}, root, 'read-1')).toBe('untrusted');
  });

  it('bounds characters, lines and control-only scans before keeping text', () => {
    const long = extractResultPreview(
      'x'.repeat(MAX_TOOL_RESULT_TEXT_UNITS * 100),
      source,
    );
    expect(long).toMatchObject({
      availability: 'available',
      text: 'x'.repeat(MAX_TOOL_RESULT_TEXT_UNITS),
      truncated: true,
    });
    const lines = extractResultPreview(
      Array.from({ length: 1_000 }, (_, i) => `line ${i}`).join('\n'),
      source,
    );
    expect(lines.availability).toBe('available');
    if (lines.availability !== 'available') throw new Error('Expected text');
    expect(lines.text.split('\n')).toHaveLength(MAX_TOOL_RESULT_LINES);
    expect(lines.truncated).toBe(true);
    expect(isToolResultPreview(lines)).toBe(true);
    expect(extractResultPreview('\u0000'.repeat(100_000), source)).toEqual({
      availability: 'unavailable',
      reason: 'unsupported',
    });
    const unicode = extractResultPreview(
      'x'.repeat(MAX_TOOL_RESULT_TEXT_UNITS - 1) + '🦊',
      source,
    );
    expect(unicode).toMatchObject({
      text: 'x'.repeat(MAX_TOOL_RESULT_TEXT_UNITS - 1),
      truncated: true,
    });
  });

  it('cleans terminal noise, distinguishes empty from binary, and suppresses recognizable secrets', () => {
    expect(extractResultPreview('\u001b[31mhello\u001b[0m\nworld', source)).toMatchObject(
      { text: 'hello\nworld', truncated: false },
    );
    expect(extractResultPreview(' \n\t', source)).toEqual({
      availability: 'unavailable',
      reason: 'empty',
    });
    expect(
      extractResultPreview([{ type: 'text', text: 'text' }, { type: 'image' }], source),
    ).toEqual({ availability: 'unavailable', reason: 'unsupported' });
    expect(
      extractResultPreview('password = "fixture-not-a-real-password"', source),
    ).toEqual({ availability: 'unavailable', reason: 'restricted' });
    expect(
      extractResultPreview(
        [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ],
        source,
      ),
    ).toMatchObject({ text: 'one\ntwo' });
  });
});
