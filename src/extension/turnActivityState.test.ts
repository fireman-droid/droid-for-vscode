import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
} from '../shared/bridgeMessages';
import {
  collectToolFilePaths,
  createTurnActivityState,
  hasSubagentRows,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingDelta,
  projectToolEvent,
  reconcileSubagentSummaries,
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

  it('keeps the background hint monotonic across the tool lifecycle', () => {
    // A backgrounded execute row carries the hint from the start and
    // keeps it through completion even though tool-result events never
    // repeat the input flag.
    const started = projectToolEvent(
      createTurnActivityState(),
      {
        type: 'tool-start',
        toolName: 'Execute',
        toolUseId: 'tool-bg',
        action: 'Ran a local command',
        backgroundHint: { fireAndForget: true },
      },
      1_000,
    );
    expect(started.projection).toMatchObject({
      backgroundHint: { fireAndForget: true },
    });
    const completed = projectToolEvent(
      started.state,
      {
        type: 'tool-result',
        toolName: 'Execute',
        toolUseId: 'tool-bg',
        action: 'Ran a local command',
        isError: false,
      },
      2_000,
    );
    expect(completed.projection).toMatchObject({
      status: 'completed',
      backgroundHint: { fireAndForget: true },
    });

    // A streamed delta may create the row before the accumulating
    // input carries the flag; the later tool-start locks it in.
    const bare = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-late-bg',
      action: 'Ran a local command',
    });
    expect(bare.projection).not.toHaveProperty('backgroundHint');
    const marked = projectToolEvent(bare.state, {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-late-bg',
      action: 'Ran a local command',
      backgroundHint: { fireAndForget: true },
    });
    expect(marked.projection).toMatchObject({
      status: 'running',
      backgroundHint: { fireAndForget: true },
    });
    // Repeating the same hint projects nothing new.
    const repeatedHint = projectToolEvent(marked.state, {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-late-bg',
      action: 'Ran a local command',
      backgroundHint: { fireAndForget: true },
    });
    expect(repeatedHint.projection).toBeNull();
  });

  it('collects unique tool file paths in first-observed order', () => {
    let state = createTurnActivityState();
    const events = [
      {
        type: 'tool-start' as const,
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Updated workspace files',
        filePath: 'src/b.ts',
      },
      {
        type: 'tool-start' as const,
        toolName: 'Read',
        toolUseId: 'tool-2',
        action: 'Read workspace files',
      },
      {
        type: 'tool-start' as const,
        toolName: 'Create',
        toolUseId: 'tool-3',
        action: 'Created workspace files',
        filePath: 'src/a.ts',
      },
      {
        type: 'tool-start' as const,
        toolName: 'Edit',
        toolUseId: 'tool-4',
        action: 'Updated workspace files',
        filePath: 'src/b.ts',
      },
    ];
    for (const event of events) {
      state = projectToolEvent(state, event).state;
    }
    expect(collectToolFilePaths(state)).toEqual([
      'src/b.ts',
      'src/a.ts',
    ]);
    expect(collectToolFilePaths(createTurnActivityState())).toEqual([]);
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

  it('carries the failure excerpt onto the failed projection only', () => {
    const started = projectToolEvent(
      createTurnActivityState(),
      {
        type: 'tool-start',
        toolName: 'ApplyPatch',
        toolUseId: 'tool-patch',
        action: 'Updated workspace files',
      },
      1_000,
    );
    const failed = projectToolEvent(
      started.state,
      {
        type: 'tool-result',
        toolName: 'ApplyPatch',
        toolUseId: 'tool-patch',
        action: 'Updated workspace files',
        isError: true,
        errorText: 'Tool execution cancelled by user',
      },
      2_000,
    );
    expect(failed.projection).toMatchObject({
      status: 'failed',
      errorMessage: 'Tool execution cancelled by user',
    });

    // A successful result never projects an errorMessage, even if the
    // event carried stray text.
    const okStart = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'tool-ok',
      action: 'Read workspace files',
    });
    const ok = projectToolEvent(okStart.state, {
      type: 'tool-result',
      toolName: 'Read',
      toolUseId: 'tool-ok',
      action: 'Read workspace files',
      isError: false,
      errorText: 'should be ignored',
    });
    expect(ok.projection).not.toHaveProperty('errorMessage');

    // Result-first failures carry the excerpt too.
    const resultFirst = projectToolEvent(createTurnActivityState(), {
      type: 'tool-result',
      toolName: 'Execute',
      toolUseId: 'tool-first',
      action: 'Ran a local command',
      isError: true,
      errorText: 'command exited with 1',
    });
    expect(resultFirst.projection).toMatchObject({
      status: 'failed',
      errorMessage: 'command exited with 1',
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

  it('streams execute output tails and keeps the final tail on completion', () => {
    const started = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
    });
    const first = projectToolEvent(started.state, {
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
      outputTail: 'line-1',
    });
    // An update without output keeps the last tail visible.
    const silent = projectToolEvent(first.state, {
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
    });
    const second = projectToolEvent(silent.state, {
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
      outputTail: 'line-1\nline-2',
    });
    const completed = projectToolEvent(second.state, {
      type: 'tool-result',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      isError: false,
    });

    expect(first.projection).toMatchObject({ outputTail: 'line-1' });
    expect(silent.projection).toMatchObject({ outputTail: 'line-1' });
    expect(second.projection).toMatchObject({
      outputTail: 'line-1\nline-2',
    });
    expect(completed.projection).toMatchObject({
      status: 'completed',
      outputTail: 'line-1\nline-2',
    });
  });

  it('keeps streaming changed output tails past the progress cap', () => {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
    }).state;
    for (
      let index = 0;
      index < MAX_TOOL_PROGRESS_UPDATES_PER_TOOL;
      index += 1
    ) {
      state = projectToolEvent(state, {
        type: 'tool-progress',
        toolName: 'Execute',
        toolUseId: 'tool-exec',
        action: 'Ran a local command',
        updateKind: 'status',
        outputTail: `tail-${index}`,
      }).state;
    }
    const unchanged = projectToolEvent(state, {
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
      outputTail: `tail-${MAX_TOOL_PROGRESS_UPDATES_PER_TOOL - 1}`,
    });
    const changed = projectToolEvent(unchanged.state, {
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
      outputTail: 'fresh tail',
    });

    expect(unchanged.projection).toBeNull();
    expect(changed.projection).toMatchObject({
      progressCount: MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
      outputTail: 'fresh tail',
    });
  });

  it('upgrades the Task row named by the notification to a subagent row', () => {
    const started = projectToolEvent(
      createTurnActivityState(),
      {
        type: 'tool-start',
        toolName: 'Task',
        toolUseId: 'task-1',
        action: 'Delegated to a subagent',
      },
      1_000,
    );
    const upgraded = projectSubagentStarted(started.state, {
      toolUseId: 'task-1',
      subagentType: 'explore',
      description: 'Survey the auth module',
    });
    const duplicate = projectSubagentStarted(upgraded.state, {
      toolUseId: 'task-1',
      subagentType: 'explore',
      description: 'Survey the auth module',
    });

    expect(upgraded.projection).toEqual({
      toolUseId: 'task-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      subagent: {
        type: 'explore',
        description: 'Survey the auth module',
        status: 'running',
      },
    });
    expect(hasSubagentRows(started.state)).toBe(false);
    expect(hasSubagentRows(upgraded.state)).toBe(true);
    expect(duplicate.projection).toBeNull();
    expect(duplicate.state).toBe(upgraded.state);
  });

  it('falls back to the newest running Task row when the id is missing', () => {
    let state = createTurnActivityState();
    for (const toolUseId of ['task-a', 'task-b']) {
      state = projectToolEvent(state, {
        type: 'tool-start',
        toolName: 'Task',
        toolUseId,
        action: 'Delegated to a subagent',
      }).state;
    }
    state = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'read-1',
      action: 'Read workspace files',
    }).state;

    const upgraded = projectSubagentStarted(state, {
      toolUseId: null,
      subagentType: 'explore',
      description: '',
    });
    const noTarget = projectSubagentStarted(
      createTurnActivityState(),
      {
        toolUseId: 'task-unknown',
        subagentType: 'explore',
        description: '',
      },
    );

    expect(upgraded.projection).toMatchObject({
      toolUseId: 'task-b',
      subagent: { type: 'explore', description: '', status: 'running' },
    });
    expect(noTarget.projection).toBeNull();
    expect(noTarget.state.tools.size).toBe(0);
  });

  it('settles terminal subagent rows from the ledger newest-first', () => {
    let state = createTurnActivityState();
    for (const toolUseId of ['task-1', 'task-2']) {
      state = projectToolEvent(state, {
        type: 'tool-start',
        toolName: 'Task',
        toolUseId,
        action: 'Delegated to a subagent',
      }).state;
      state = projectSubagentStarted(state, {
        toolUseId,
        subagentType: 'explore',
        description: 'Same delegation',
      }).state;
      state = projectToolEvent(state, {
        type: 'tool-result',
        toolName: 'Task',
        toolUseId,
        action: 'Delegated to a subagent',
        isError: false,
      }).state;
    }

    const settled = reconcileSubagentSummaries(state, [
      {
        type: 'explore',
        description: 'Same delegation',
        status: 'completed',
        toolUseCount: 4,
        durationMs: 1_200,
      },
      {
        type: 'explore',
        description: 'Same delegation',
        status: 'completed',
        toolUseCount: 9,
        durationMs: 5_000,
      },
    ]);

    expect(settled.projections).toHaveLength(2);
    expect(settled.projections[0]).toMatchObject({
      toolUseId: 'task-1',
      status: 'completed',
      subagent: {
        status: 'completed',
        toolUseCount: 4,
        durationMs: 1_200,
      },
    });
    expect(settled.projections[1]).toMatchObject({
      toolUseId: 'task-2',
      status: 'completed',
      subagent: {
        status: 'completed',
        toolUseCount: 9,
        durationMs: 5_000,
      },
    });
  });

  it('never settles rows the stream left running and tolerates an empty ledger', () => {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId: 'task-broken',
      action: 'Delegated to a subagent',
    }).state;
    state = projectSubagentStarted(state, {
      toolUseId: 'task-broken',
      subagentType: 'explore',
      description: 'Interrupted delegation',
    }).state;

    const skipped = reconcileSubagentSummaries(state, [
      {
        type: 'explore',
        description: 'Interrupted delegation',
        status: 'cancelled',
      },
    ]);
    const empty = reconcileSubagentSummaries(state, []);

    expect(skipped.projections).toHaveLength(0);
    expect(skipped.state).toBe(state);
    expect(empty.projections).toHaveLength(0);
    expect(empty.state).toBe(state);
  });

  it('leaves rows alone when the ledger repeats the streamed status', () => {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId: 'task-1',
      action: 'Delegated to a subagent',
    }).state;
    state = projectSubagentStarted(state, {
      toolUseId: 'task-1',
      subagentType: 'explore',
      description: 'Steady delegation',
    }).state;
    state = projectToolEvent(state, {
      type: 'tool-result',
      toolName: 'Task',
      toolUseId: 'task-1',
      action: 'Delegated to a subagent',
      isError: false,
    }).state;
    const running = reconcileSubagentSummaries(state, [
      {
        type: 'explore',
        description: 'Steady delegation',
        status: 'running',
      },
    ]);
    const unmatched = reconcileSubagentSummaries(state, [
      {
        type: 'other-type',
        description: 'Different delegation',
        status: 'completed',
      },
    ]);

    expect(running.projections).toHaveLength(0);
    expect(unmatched.projections).toHaveLength(0);
  });
});
