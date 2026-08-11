import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
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
    const started = projectToolEvent(
      createTurnActivityState(),
      {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      },
      1_000,
    );
    const duplicate = projectToolEvent(
      started.state,
      {
        type: 'tool-progress',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        updateKind: 'status',
      },
      2_000,
    );
    const completed = projectToolEvent(
      duplicate.state,
      {
        type: 'tool-result',
        toolName: 'Read safely',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      },
      4_500,
    );
    const regressed = projectToolEvent(completed.state, {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'tool-1',
      action: 'Read workspace files',
    });

    expect(started.projection).toEqual({
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
    });
    expect(duplicate.projection).toEqual({
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'running',
      progressCount: 1,
      latestUpdateKind: 'status',
    });
    expect(completed.projection).toEqual({
      toolUseId: 'tool-1',
      toolName: 'Read safely',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'status',
      durationMs: 3_500,
    });
    expect(regressed.projection).toBeNull();
  });

  it('carries a tool file path through progress, late fill, and result', () => {
    const started = projectToolEvent(
      createTurnActivityState(),
      {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'tool-edit',
        action: 'Updated workspace files',
        filePath: 'src/app.ts',
      },
      1_000,
    );
    const progressed = projectToolEvent(
      started.state,
      {
        type: 'tool-progress',
        toolName: 'Edit',
        toolUseId: 'tool-edit',
        action: 'Updated workspace files',
        updateKind: 'status',
      },
      2_000,
    );
    const completed = projectToolEvent(
      progressed.state,
      {
        type: 'tool-result',
        toolName: 'Edit',
        toolUseId: 'tool-edit',
        action: 'Updated workspace files',
        isError: false,
      },
      3_000,
    );

    expect(started.projection).toMatchObject({
      filePath: 'src/app.ts',
    });
    expect(progressed.projection).toMatchObject({
      filePath: 'src/app.ts',
    });
    expect(completed.projection).toMatchObject({
      status: 'completed',
      filePath: 'src/app.ts',
    });

    // A streamed delta can create the row before the full call carries
    // the path; the later tool-start fills it in exactly once.
    const bare = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Create',
      toolUseId: 'tool-late',
      action: 'Created workspace files',
    });
    expect(bare.projection).not.toHaveProperty('filePath');
    const filled = projectToolEvent(bare.state, {
      type: 'tool-start',
      toolName: 'Create',
      toolUseId: 'tool-late',
      action: 'Created workspace files',
      filePath: 'docs/new.md',
    });
    expect(filled.projection).toMatchObject({
      status: 'running',
      filePath: 'docs/new.md',
    });
    const repeated = projectToolEvent(filled.state, {
      type: 'tool-start',
      toolName: 'Create',
      toolUseId: 'tool-late',
      action: 'Created workspace files',
      filePath: 'docs/new.md',
    });
    expect(repeated.projection).toBeNull();
  });

  it('creates a terminal tool row when the result arrives first', () => {
    const result = projectToolEvent(createTurnActivityState(), {
      type: 'tool-result',
      toolName: 'Write',
      toolUseId: 'tool-result-only',
      action: 'Updated workspace files',
      isError: true,
    });

    expect(result.projection).toEqual({
      toolUseId: 'tool-result-only',
      toolName: 'Write',
      action: 'Updated workspace files',
      status: 'failed',
      progressCount: 0,
      latestUpdateKind: null,
    });
  });

  it('caps unique tools while continuing to update tracked tools', () => {
    let state = createTurnActivityState();
    for (let index = 0; index < MAX_TOOL_ACTIVITIES_PER_TURN; index += 1) {
      state = projectToolEvent(state, {
        type: 'tool-start',
        toolName: `Tool ${index}`,
        toolUseId: `tool-${index}`,
        action: `Used Tool ${index}`,
      }).state;
    }

    const ignored = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'Over cap',
      toolUseId: 'over-cap',
      action: 'Used Over cap',
    });
    const completed = projectToolEvent(ignored.state, {
      type: 'tool-result',
      toolName: 'Tool 0',
      toolUseId: 'tool-0',
      action: 'Used Tool 0',
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

  it('bounds progress updates without losing terminal lifecycle', () => {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-progress',
      action: 'Ran a local command',
    }).state;
    for (
      let index = 0;
      index < MAX_TOOL_PROGRESS_UPDATES_PER_TOOL + 1;
      index += 1
    ) {
      state = projectToolEvent(state, {
        type: 'tool-progress',
        toolName: 'Execute',
        toolUseId: 'tool-progress',
        action: 'Ran a local command',
        updateKind: 'status',
      }).state;
    }
    const completed = projectToolEvent(state, {
      type: 'tool-result',
      toolName: 'Execute',
      toolUseId: 'tool-progress',
      action: 'Ran a local command',
      isError: false,
    });

    expect(completed.projection).toMatchObject({
      status: 'completed',
      progressCount: MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
      latestUpdateKind: 'status',
    });
  });
});
