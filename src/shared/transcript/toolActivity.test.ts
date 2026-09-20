import { describe, expect, it } from 'vitest';
import { browserToolAction, resolveToolAction, summarizeToolAction } from './toolActivity';

describe('tool action titles', () => {
  it.each([
    ['ApplyPatch', 'Updated workspace files', 'Apply patch'],
    ['AskUser', 'Requested your input', 'Ask for input'],
    ['Create', 'Created workspace files', 'Create file'],
    ['Edit', 'Updated workspace files', 'Edit file'],
    ['Execute', 'Ran a local command', 'Run command'],
    ['ExitSpecMode', 'Prepared an implementation plan', 'Present implementation plan'],
    ['FetchUrl', 'Researched an external source', 'Fetch URL'],
    ['Glob', 'Inspected workspace structure', 'Find files'],
    ['Grep', 'Searched workspace content', 'Search files'],
    ['LS', 'Inspected workspace structure', 'List directory'],
    ['Read', 'Read workspace files', 'Read file'],
    ['Skill', 'Loaded workflow guidance', 'Load skill'],
    ['Task', 'Delegated focused work', 'Delegate task'],
    ['TaskOutput', 'Checked delegated work', 'Check task output'],
    ['TodoWrite', 'Updated the task plan', 'Update task plan'],
    ['WebSearch', 'Researched external sources', 'Search web'],
    ['Write', 'Updated workspace files', 'Write file'],
  ])('uses a neutral %s title for new and restored activity', (toolName, oldAction, title) => {
    expect(summarizeToolAction(toolName)).toBe(title);
    expect(resolveToolAction(toolName, oldAction)).toBe(title);
  });

  it.each([
    ['browser_targets', 'Browser tabs'],
    ['browser_screenshot', 'Capture screenshot'],
    ['browser.snapshot', 'Inspect page'],
    ['mcp__browser__click', 'Click element'],
    ['mcp__tools__browser_network', 'Inspect network'],
    ['mcp__tools__clear_browser_env', 'Clear browser environment'],
    ['execute_browser_action', 'Run browser action'],
    ['browser_assert', 'Check browser assertion'],
    ['browser_collect_trace', 'Browser · Collect trace'],
  ])('keeps the concrete browser action for %s', (toolName, title) => {
    expect(browserToolAction(toolName)).toBe(title);
    expect(resolveToolAction(toolName, 'Verified the interface')).toBe(title);
  });

  it('keeps distinct Figma operations and humanizes the MCP leaf', () => {
    expect(resolveToolAction('mcp__figma__get_design_context', 'Inspected the design'))
      .toBe('Figma · Get design context');
    expect(summarizeToolAction('mcp__figma__get_screenshot')).toBe('Figma · Get screenshot');
    expect(summarizeToolAction('mcp__database__read')).toBe('Read');
    expect(resolveToolAction('mcp__service__list_records', 'Used mcp service list records'))
      .toBe('List records');
    expect(browserToolAction('Read')).toBeUndefined();
  });

  it('preserves model summaries, including an old title belonging to another tool', () => {
    expect(resolveToolAction('Execute', 'Check the production build')).toBe('Check the production build');
    expect(resolveToolAction('browser_snapshot', 'Inspect login form')).toBe('Inspect login form');
    expect(resolveToolAction('Execute', 'Read workspace files')).toBe('Read workspace files');
    expect(resolveToolAction('custom_tool', 'Used this data to compare results'))
      .toBe('Used this data to compare results');
  });
});
