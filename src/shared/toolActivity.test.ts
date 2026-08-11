import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  summarizeToolAction,
} from './toolActivity';

describe('summarizeToolAction', () => {
  it.each([
    ['Read', 'Read workspace files'],
    ['functions.Read', 'Read workspace files'],
    ['Execute', 'Ran a local command'],
    ['ApplyPatch', 'Updated workspace files'],
    ['TodoWrite', 'Updated the task plan'],
    ['figma___get_design_context', 'Inspected the design'],
    ['agent-browser', 'Verified the interface'],
  ])('maps %s to a semantic activity', (toolName, expected) => {
    expect(summarizeToolAction(toolName)).toBe(expected);
  });

  it('humanizes unknown names without exposing control characters', () => {
    expect(summarizeToolAction('custom.namespace/run_task\u0000')).toBe(
      'Used run task',
    );
  });

  it('bounds fallback summaries', () => {
    expect(summarizeToolAction('x'.repeat(1_000))).toHaveLength(
      MAX_TOOL_ACTION_SUMMARY_LENGTH,
    );
  });
});
