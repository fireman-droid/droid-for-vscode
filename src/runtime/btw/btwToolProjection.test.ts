import { describe, expect, it } from 'vitest';
import { BtwToolProjection } from './btwToolProjection';
import { applyBtwTool, appendBtwQuestion, completeBtwEntry, failBtwEntry } from '../../extension/btw/btwCardState';
import { EMPTY_SESSION_BTW_STATE, parseSessionBtwMessage } from '../../shared/protocol/btwProtocol';
import { isBtwToolActivities, MAX_BTW_TOOL_TEXT, retainBtwTools, type BtwToolActivity } from '../../shared/protocol/btwToolActivity';

const name = 'btw-0123456789abcdef01234567___run_javascript';
const start = { type: 'tool_call', toolUseId: 'run-1', name, input: { code: 'assert(1 === 1)', language: 'typescript' } };

describe('BTW tool activity', () => {
  it('projects process and daemon calls identically without forwarding arbitrary arguments', () => {
    const process = new BtwToolProjection('/project');
    const daemon = new BtwToolProjection('/project');
    const input = { file_path: '/project/src/cart.ts', secret: 'do-not-project' };
    const left = process.project({ type: 'tool_call', toolUse: { id: 'read-1', name: 'Read', input } });
    const right = daemon.project({ type: 'tool_call', toolUseId: 'read-1', name: 'Read', input });
    expect(left).toEqual(right);
    expect(left?.tool).toMatchObject({ id: 'read-1', kind: 'read', target: 'src/cart.ts', state: 'running' });
    expect(JSON.stringify(left)).not.toContain('do-not-project');
  });

  it.each([
    [{ ok: true, output: 'one loader call', value: '42' }, 'done'],
    [{ ok: false, output: 'before error', error: 'Assertion failed' }, 'error'],
    [{ text: 'looks good' }, 'incomplete'],
  ] as const)('uses structured execution outcome %j', (result, state) => {
    const projection = new BtwToolProjection();
    projection.project(start);
    const event = projection.project({ type: 'tool_result', toolUseId: 'run-1', isError: false,
      content: [{ type: 'text', text: JSON.stringify(result) }] });
    expect(event?.tool).toMatchObject({ state, code: 'assert(1 === 1)', language: 'typescript', kind: 'analysis' });
    if (state === 'done') expect(event?.tool.output).toBe('one loader call\n42');
    if (state === 'error') expect(event?.tool.error).toBe('Assertion failed');
  });

  it('retains a permission or tool error without reporting execution success', () => {
    const projection = new BtwToolProjection();
    projection.project(start);
    expect(projection.project({ type: 'tool_result', toolUseId: 'run-1', isError: true, content: 'Permission denied' })?.tool)
      .toMatchObject({ state: 'error', error: 'Permission denied' });
    expect(projection.project({ ...start, type: 'tool_call_delta', toolUse: { id: 'run-1', name, input: {} } })).toBeNull();
    expect(projection.project({ type: 'tool_result', toolUseId: 'unknown', content: 'ok' })).toBeNull();
  });

  it('does not classify unrelated MCP tools as verified local examples', () => {
    const projection = new BtwToolProjection();
    expect(projection.project({ ...start, name: 'thirdparty___run_javascript' })?.tool.kind).toBe('other');
  });

  it('settles interrupted tools without losing results and roundtrips the Bridge', () => {
    const projection = new BtwToolProjection();
    const tool = projection.project(start)!.tool;
    const initial = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'question-1', 'Explain this');
    const running = applyBtwTool(initial, 'question-1', tool);
    for (const settled of [completeBtwEntry(running, 'question-1'), failBtwEntry(running, 'question-1', 'Disconnected')]) {
      expect(settled.entries[0]?.tools?.[0]?.state).toBe('incomplete');
      const late = applyBtwTool(settled, 'question-1', { ...tool, state: 'done' });
      expect(late).toEqual(settled);
      expect(parseSessionBtwMessage({ type: 'session.btw', sequence: 1, sessionId: 'main', btw: settled })?.btw).toEqual(settled);
    }
    const done = applyBtwTool(running, 'question-1', { ...tool, state: 'done' });
    expect(completeBtwEntry(done, 'question-1').entries[0]?.tools?.[0]?.state).toBe('done');
    expect(done.entries[0]?.tools).toHaveLength(1);
  });

  it('bounds retained code and output and rejects malformed host data', () => {
    const tools: BtwToolActivity[] = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, name,
      kind: 'analysis', state: 'done', code: 'x'.repeat(32_000), output: 'y'.repeat(16_000) }));
    const retained = retainBtwTools(tools);
    expect(retained).toHaveLength(24);
    expect(retained.at(-1)?.code?.length).toBe(32_000);
    expect(retained[0]?.detailsOmitted).toBe(true);
    expect(retained.reduce((n, item) => n + (item.code?.length ?? 0) + (item.output?.length ?? 0), 0)).toBeLessThanOrEqual(MAX_BTW_TOOL_TEXT);
    expect(isBtwToolActivities(retained)).toBe(true);
    expect(isBtwToolActivities([tools[0], tools[0]])).toBe(false);
    expect(isBtwToolActivities([{ ...tools[0], arbitrary: true }])).toBe(false);
    const state = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'q', 'Explain');
    expect(parseSessionBtwMessage({ type: 'session.btw', sequence: 1, sessionId: 'main',
      btw: { ...state, entries: [{ ...state.entries[0], tools: [{ ...tools[0], state: 'fake-success' }] }] } })).toBeNull();
  });
});
