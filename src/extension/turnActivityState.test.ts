import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
} from '../shared/bridgeMessages';
import {
  createTurnActivityState,
  projectAssistantDelta,
  projectThinkingDelta,
  projectToolEvent,
} from './turnActivityState';

describe('turnActivityState', () => {
  it('caps assistant deltas and reports clipping exactly once', () => {
    const initial = createTurnActivityState();
    const empty = projectAssistantDelta(initial, '');
    const clipped = projectAssistantDelta(
      empty.state,
      'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH + 1),
    );
    const suppressed = projectAssistantDelta(clipped.state, 'later');

    expect(empty.projection).toBeNull();
    expect(empty.state).toBe(initial);
    expect(clipped.projection).toEqual({
      delta: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
      truncated: true,
    });
    expect(clipped.state.assistantTextLength).toBe(
      MAX_ASSISTANT_TEXT_LENGTH,
    );
    expect(suppressed.projection).toBeNull();
    expect(suppressed.state).toBe(clipped.state);
  });

  it('marks only the first non-empty delta after an exact assistant fill', () => {
    const filled = projectAssistantDelta(
      createTurnActivityState(),
      'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    );
    const empty = projectAssistantDelta(filled.state, '');
    const marker = projectAssistantDelta(empty.state, 'omitted');
    const suppressed = projectAssistantDelta(marker.state, 'later');

    expect(filled.projection).toMatchObject({
      delta: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
      truncated: false,
    });
    expect(empty.projection).toBeNull();
    expect(empty.state).toBe(filled.state);
    expect(marker.projection).toEqual({
      delta: '',
      truncated: true,
    });
    expect(suppressed.projection).toBeNull();
  });

  it('caps cumulative thinking and reports truncation exactly once', () => {
    const first = projectThinkingDelta(
      createTurnActivityState(),
      'a'.repeat(MAX_THINKING_TEXT_LENGTH - 1),
    );
    const clipped = projectThinkingDelta(first.state, 'bc');
    const suppressed = projectThinkingDelta(clipped.state, 'later');

    expect(first.projection).toMatchObject({
      truncated: false,
    });
    expect(clipped.projection).toEqual({
      delta: 'b',
      truncated: true,
    });
    expect(suppressed.projection).toBeNull();
    expect(clipped.state.thinkingTextLength).toBe(
      MAX_THINKING_TEXT_LENGTH,
    );
  });

  it('marks the first non-empty delta after an exact fill as truncated', () => {
    const filled = projectThinkingDelta(
      createTurnActivityState(),
      'a'.repeat(MAX_THINKING_TEXT_LENGTH),
    );
    const empty = projectThinkingDelta(filled.state, '');
    const marker = projectThinkingDelta(empty.state, 'later');
    const suppressed = projectThinkingDelta(marker.state, 'again');

    expect(filled.projection).toMatchObject({
      delta: 'a'.repeat(MAX_THINKING_TEXT_LENGTH),
      truncated: false,
    });
    expect(empty.projection).toBeNull();
    expect(empty.state).toBe(filled.state);
    expect(marker.projection).toEqual({
      delta: '',
      truncated: true,
    });
    expect(suppressed.projection).toBeNull();
  });

  it('coalesces running tool events and prevents terminal regression', () => {
    const started = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'tool-1',
    });
    const duplicate = projectToolEvent(started.state, {
      type: 'tool-progress',
      toolName: 'Read',
      toolUseId: 'tool-1',
    });
    const completed = projectToolEvent(duplicate.state, {
      type: 'tool-result',
      toolName: 'Read safely',
      toolUseId: 'tool-1',
      isError: false,
    });
    const regressed = projectToolEvent(completed.state, {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'tool-1',
    });

    expect(started.projection).toEqual({
      toolUseId: 'tool-1',
      toolName: 'Read',
      status: 'running',
    });
    expect(duplicate.projection).toBeNull();
    expect(completed.projection).toEqual({
      toolUseId: 'tool-1',
      toolName: 'Read safely',
      status: 'completed',
    });
    expect(regressed.projection).toBeNull();
  });

  it('creates a terminal tool row when the result arrives first', () => {
    const result = projectToolEvent(createTurnActivityState(), {
      type: 'tool-result',
      toolName: 'Write',
      toolUseId: 'tool-result-only',
      isError: true,
    });

    expect(result.projection).toEqual({
      toolUseId: 'tool-result-only',
      toolName: 'Write',
      status: 'failed',
    });
  });

  it('caps unique tools while continuing to update tracked tools', () => {
    let state = createTurnActivityState();
    for (let index = 0; index < MAX_TOOL_ACTIVITIES_PER_TURN; index += 1) {
      state = projectToolEvent(state, {
        type: 'tool-start',
        toolName: `Tool ${index}`,
        toolUseId: `tool-${index}`,
      }).state;
    }

    const ignored = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'Over cap',
      toolUseId: 'over-cap',
    });
    const completed = projectToolEvent(ignored.state, {
      type: 'tool-result',
      toolName: 'Tool 0',
      toolUseId: 'tool-0',
      isError: false,
    });

    expect(state.tools.size).toBe(MAX_TOOL_ACTIVITIES_PER_TURN);
    expect(ignored.projection).toBeNull();
    expect(ignored.state).toBe(state);
    expect(completed.projection).toMatchObject({
      toolUseId: 'tool-0',
      status: 'completed',
    });
  });
});
