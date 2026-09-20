import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractExecuteSummary, extractToolAction, extractToolTarget } from './toolDetail';

const workspace = resolve('workspace');

describe('tool display input boundaries', () => {
  it('shows only workspace-relative Read and LS targets from their supported fields', () => {
    expect(extractToolTarget('Read', { file_path: resolve(workspace, 'src/app.ts') }, workspace))
      .toBe('src/app.ts');
    expect(extractToolTarget('Read', { filePath: 'src/app.ts' }, workspace)).toBe('src/app.ts');
    expect(extractToolTarget('LS', { directory_path: resolve(workspace, 'src') }, workspace)).toBe('src');
    expect(extractToolTarget('Read', { file_path: resolve(workspace, '../outside') }, workspace))
      .toBeUndefined();
    expect(extractToolTarget('Read', { file_path: 'src/app.ts' })).toBeUndefined();
  });

  it('does not grant native target or command-summary handling to MCP tools with matching leaves', () => {
    for (const tool of ['mcp__database__read', 'mcp__browser__ls', 'mcp__service__grep']) {
      expect(extractToolTarget(tool, {
        file_path: 'src/app.ts', directory_path: 'src', path: 'src', pattern: 'PRIVATE_INPUT',
      }, workspace)).toBeUndefined();
    }
    expect(extractToolTarget('browser_evaluate', { code: 'PRIVATE_INPUT', path: 'src' }, workspace))
      .toBeUndefined();
    expect(extractExecuteSummary('mcp__remote__execute', { summary: 'PRIVATE_INPUT' })).toBeUndefined();
  });

  it('shows the named built-in skill with bounded text cleanup without matching an MCP skill tool', () => {
    expect(extractToolTarget('Skill', { skill: '  frontend-design\n\u0000  ' })).toBe('frontend-design');
    expect(extractToolTarget('mcp__service__skill', { skill: 'PRIVATE_INPUT' })).toBeUndefined();
  });

  it('keeps the model-authored Execute summary without substituting command text', () => {
    expect(extractExecuteSummary('Execute', { summary: 'Check project types', command: 'PRIVATE_COMMAND' }))
      .toBe('Check project types');
    expect(extractExecuteSummary('Execute', { command: 'PRIVATE_COMMAND' })).toBeUndefined();
    expect(extractToolAction('Execute', { summary: 'Check project types', command: 'PRIVATE_COMMAND' }))
      .toBe('Check project types');
  });

  it.each([
    ['execute_browser_action', { action: 'navigate', url: 'PRIVATE_URL' }, 'Navigate page'],
    ['browser_action', { action: { kind: 'fill', value: 'PRIVATE_VALUE' } }, 'Fill field'],
    ['mcp__cursor__browser_action', { action: { kind: 'inspectTarget', target: 'PRIVATE_TARGET' } }, 'Inspect element'],
    ['browser_get', { kind: 'text', target: { selector: 'PRIVATE_LOCATOR' } }, 'Read page text'],
    ['browser_get', { kind: 'title' }, 'Read page title'],
  ])('projects a documented enum title from %s without raw arguments', (toolName, input, title) => {
    expect(extractToolAction(toolName, input)).toBe(title);
  });

  it('rejects unknown browser enum values and tool shapes instead of exposing input', () => {
    expect(extractToolAction('browser_action', { action: { kind: 'PRIVATE_ACTION' } })).toBeUndefined();
    expect(extractToolAction('browser_action', { action: { kind: 'navigate' } })).toBeUndefined();
    expect(extractToolAction('execute_browser_action', { action: 'inspectTarget' })).toBeUndefined();
    expect(extractToolAction('browser_get', { kind: 'toString' })).toBeUndefined();
    expect(extractToolAction('browser_evaluate', { code: 'PRIVATE_CODE' })).toBeUndefined();
    expect(extractToolAction('mcp__service__action', { action: { kind: 'fill' } })).toBeUndefined();
  });
});
