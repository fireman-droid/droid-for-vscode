import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  type SessionTranscriptItem,
} from '../shared/bridgeMessages';
import {
  applySubagentSettlement,
  collectRunningSubagentRows,
  collectToolFilePaths,
  collectTranscriptSubagentRows,
  createTurnActivityState,
  hasSubagentRows,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  reconcileSubagentSummaries,
  settleZombieSubagents,
  type TurnActivityState,
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
      'message-1:0',
    );
    const clipped = projectThinkingDelta(
      first.state,
      'bc',
      'message-1:0',
    );
    const suppressed = projectThinkingDelta(
      clipped.state,
      'later',
      'message-1:0',
    );

    expect(first.projection).toMatchObject({
      truncated: false,
    });
    expect(clipped.projection).toEqual({
      delta: 'b',
      truncated: true,
      segmentIndex: 0,
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
      'message-1:0',
    );
    const empty = projectThinkingDelta(filled.state, '', 'message-1:0');
    const marker = projectThinkingDelta(
      empty.state,
      'later',
      'message-2:0',
    );
    const suppressed = projectThinkingDelta(
      marker.state,
      'again',
      'message-2:0',
    );

    expect(filled.projection).toMatchObject({
      delta: 'a'.repeat(MAX_THINKING_TEXT_LENGTH),
      truncated: false,
    });
    expect(empty.projection).toBeNull();
    expect(empty.state).toBe(filled.state);
    // The bare truncation marker pins to the last segment that showed
    // text instead of opening an empty row for the clipped segment.
    expect(marker.projection).toEqual({
      delta: '',
      truncated: true,
      segmentIndex: 0,
    });
    expect(marker.state.thinkingSegmentKey).toBe('message-1:0');
    expect(suppressed.projection).toBeNull();
    // The fully clipped segment never completes: its key never
    // registered, so the completion projects nothing.
    expect(
      projectThinkingComplete(marker.state, 'message-2:0'),
    ).toBeNull();
    expect(
      projectThinkingComplete(marker.state, 'message-1:0'),
    ).toEqual({ segmentIndex: 0 });
  });

  it('opens a new segment per messageId:blockIndex key', () => {
    const first = projectThinkingDelta(
      createTurnActivityState(),
      'First thought',
      'message-1:0',
    );
    const more = projectThinkingDelta(
      first.state,
      ' continues',
      'message-1:0',
    );
    const second = projectThinkingDelta(
      more.state,
      'Second thought',
      'message-2:0',
    );

    expect(first.projection).toMatchObject({ segmentIndex: 0 });
    expect(more.projection).toMatchObject({ segmentIndex: 0 });
    expect(second.projection).toMatchObject({ segmentIndex: 1 });
    expect(second.state.thinkingSegmentIndex).toBe(1);
    expect(second.state.thinkingSegmentKey).toBe('message-2:0');
  });

  it('completes only the segment that projected text', () => {
    const initial = createTurnActivityState();
    // Empty segment (probed: complete-only, zero deltas) stays silent.
    expect(projectThinkingComplete(initial, 'message-0:0')).toBeNull();

    const first = projectThinkingDelta(
      initial,
      'First',
      'message-1:0',
    );
    expect(
      projectThinkingComplete(first.state, 'message-1:0'),
    ).toEqual({ segmentIndex: 0 });
    expect(
      projectThinkingComplete(first.state, 'message-9:0'),
    ).toBeNull();

    const second = projectThinkingDelta(
      first.state,
      'Second',
      'message-2:0',
    );
    expect(
      projectThinkingComplete(second.state, 'message-2:0'),
    ).toEqual({ segmentIndex: 1 });
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

  it('replaces a truncated streamed file path with the complete one', () => {
    // A partial input parse can close a string mid-way (observed
    // 2026-08-12: a Create path stuck at "Canvas-API-学习" while the
    // real file was "Canvas-API-学习文档.md"). The full call's path
    // must win, and the corrected path must reach the changed-files
    // summary.
    const partial = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Create',
      toolUseId: 'tool-cjk',
      action: 'Created workspace files',
      filePath: 'Canvas-API-学习',
    });
    expect(partial.projection).toMatchObject({
      filePath: 'Canvas-API-学习',
    });
    const complete = projectToolEvent(partial.state, {
      type: 'tool-start',
      toolName: 'Create',
      toolUseId: 'tool-cjk',
      action: 'Created workspace files',
      filePath: 'Canvas-API-学习文档.md',
    });
    expect(complete.projection).toMatchObject({
      status: 'running',
      filePath: 'Canvas-API-学习文档.md',
    });
    expect(collectToolFilePaths(complete.state)).toEqual([
      'Canvas-API-学习文档.md',
    ]);

    // Multi-path calls (ApplyPatch) follow the same last-wins rule.
    const partialPatch = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'ApplyPatch',
      toolUseId: 'tool-patch',
      action: 'Updated workspace files',
      filePaths: ['src/a.ts', 'src/工具'],
    });
    const completePatch = projectToolEvent(partialPatch.state, {
      type: 'tool-start',
      toolName: 'ApplyPatch',
      toolUseId: 'tool-patch',
      action: 'Updated workspace files',
      filePaths: ['src/a.ts', 'src/工具集.ts'],
    });
    expect(completePatch.projection).not.toBeNull();
    expect(collectToolFilePaths(completePatch.state)).toEqual([
      'src/a.ts',
      'src/工具集.ts',
    ]);
    const repeatedPatch = projectToolEvent(completePatch.state, {
      type: 'tool-start',
      toolName: 'ApplyPatch',
      toolUseId: 'tool-patch',
      action: 'Updated workspace files',
      filePaths: ['src/a.ts', 'src/工具集.ts'],
    });
    expect(repeatedPatch.projection).toBeNull();

    // Streamed command details follow the same rule.
    const partialDetail = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-cmd',
      action: 'Ran a local command',
      detailKind: 'command',
      detail: 'pnpm run ty',
    });
    const completeDetail = projectToolEvent(partialDetail.state, {
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-cmd',
      action: 'Ran a local command',
      detailKind: 'command',
      detail: 'pnpm run typecheck',
    });
    expect(completeDetail.projection).toMatchObject({
      detailKind: 'command',
      detail: 'pnpm run typecheck',
    });
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
      // Multi-file ApplyPatch rows contribute every path.
      {
        type: 'tool-start' as const,
        toolName: 'ApplyPatch',
        toolUseId: 'tool-5',
        action: 'Updated workspace files',
        filePath: 'src/a.ts',
        filePaths: ['src/a.ts', 'src/c.ts'],
      },
    ];
    for (const event of events) {
      state = projectToolEvent(state, event).state;
    }
    expect(collectToolFilePaths(state)).toEqual([
      'src/b.ts',
      'src/a.ts',
      'src/c.ts',
    ]);
    expect(collectToolFilePaths(createTurnActivityState())).toEqual([]);
  });

  it('clips collected file paths to the changed-files bound', () => {
    let state = createTurnActivityState();
    state = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'ApplyPatch',
      toolUseId: 'tool-wide',
      action: 'Updated workspace files',
      filePath: 'src/file-0.ts',
      filePaths: Array.from(
        { length: MAX_CHANGED_FILES_PER_TURN + 5 },
        (_, index) => `src/file-${index}.ts`,
      ),
    }).state;
    expect(collectToolFilePaths(state)).toHaveLength(
      MAX_CHANGED_FILES_PER_TURN,
    );
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

  it('adopts the delegation identity tool-start carries, then upgrades it', () => {
    // The Task input names the delegation ~40s before the SDK's
    // child_session_available notification (probed 2026-08-13), so
    // tool-start identity must render immediately, statusless.
    const started = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId: 'task-early',
      action: 'Delegated to a subagent',
      subagent: { type: 'explore', description: 'Early identity' },
    });
    expect(started.projection).toMatchObject({
      subagent: { type: 'explore', description: 'Early identity' },
    });
    expect(started.projection?.subagent?.status).toBeUndefined();
    expect(hasSubagentRows(started.state)).toBe(true);

    // The notification stays the identity + lifecycle authority: its
    // (possibly different) identity replaces the input's guess.
    const upgraded = projectSubagentStarted(started.state, {
      toolUseId: 'task-early',
      subagentType: 'explorer',
      description: 'Ledger identity',
    });
    expect(upgraded.projection).toMatchObject({
      subagent: {
        type: 'explorer',
        description: 'Ledger identity',
        status: 'running',
      },
    });
  });

  it('skips rows that already hold a status when resolving the fallback', () => {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId: 'task-first',
      action: 'Delegated to a subagent',
    }).state;
    state = projectSubagentStarted(state, {
      toolUseId: 'task-first',
      subagentType: 'explore',
      description: 'Already running',
    }).state;
    state = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId: 'task-second',
      action: 'Delegated to a subagent',
      subagent: { type: 'explore', description: 'Identity only' },
    }).state;

    // The id-less notification must land on the identity-only row,
    // not re-claim the row that already holds a lifecycle status.
    const upgraded = projectSubagentStarted(state, {
      toolUseId: null,
      subagentType: 'explore',
      description: 'Identity only',
    });
    expect(upgraded.projection).toMatchObject({
      toolUseId: 'task-second',
      subagent: { status: 'running' },
    });
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

describe('zombie subagent settlement', () => {
  /** A settled Task row whose delegation is still running. */
  function delegatedState(
    toolUseId: string,
    description: string,
  ): TurnActivityState {
    let state = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolName: 'Task',
      toolUseId,
      action: 'Delegated focused work',
    }).state;
    state = projectSubagentStarted(state, {
      toolUseId,
      subagentType: 'explore',
      description,
    }).state;
    return projectToolEvent(state, {
      type: 'tool-result',
      toolName: 'Task',
      toolUseId,
      action: 'Delegated focused work',
      isError: false,
    }).state;
  }

  it('collects still-running delegations with their identity', () => {
    let state = delegatedState('task-bg', 'Background research');
    state = projectToolEvent(state, {
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'read-1',
      action: 'Read workspace files',
    }).state;

    expect(collectRunningSubagentRows(state, 'turn-9')).toEqual([
      {
        turnId: 'turn-9',
        toolUseId: 'task-bg',
        type: 'explore',
        description: 'Background research',
      },
    ]);

    const settled = reconcileSubagentSummaries(state, [
      {
        type: 'explore',
        description: 'Background research',
        status: 'completed',
        toolUseCount: 4,
        durationMs: 9_000,
      },
    ]).state;
    expect(collectRunningSubagentRows(settled, 'turn-9')).toEqual([]);
  });

  it('collects live delegations from a replayed transcript', () => {
    const tool = (
      overrides: Partial<
        Extract<SessionTranscriptItem, { kind: 'tool' }>
      > &
        Pick<
          Extract<SessionTranscriptItem, { kind: 'tool' }>,
          'toolUseId'
        >,
    ): SessionTranscriptItem => ({
      id: `id-${overrides.toolUseId}`,
      kind: 'tool',
      turnId: 'turn-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      ...overrides,
    });
    const transcript: SessionTranscriptItem[] = [
      { id: 'id-user', kind: 'user', text: 'Delegate research' },
      tool({
        toolUseId: 'task-live',
        subagent: {
          type: 'explore',
          description: 'Outlived the reload',
          status: 'running',
        },
      }),
      tool({
        toolUseId: 'task-queued',
        turnId: 'turn-2',
        subagent: {
          type: 'worker',
          description: 'Never started',
          status: 'pending',
        },
      }),
      tool({
        toolUseId: 'task-done',
        subagent: {
          type: 'explore',
          description: 'Already settled',
          status: 'completed',
        },
      }),
      tool({ toolUseId: 'read-1', toolName: 'Read' }),
    ];

    expect(collectTranscriptSubagentRows(transcript)).toEqual([
      {
        turnId: 'turn-1',
        toolUseId: 'task-live',
        type: 'explore',
        description: 'Outlived the reload',
      },
      {
        turnId: 'turn-2',
        toolUseId: 'task-queued',
        type: 'worker',
        description: 'Never started',
      },
    ]);
    expect(collectTranscriptSubagentRows([])).toEqual([]);
  });

  it('settles rows only with terminal ledger entries', () => {
    const rows = [
      {
        turnId: 'turn-1',
        toolUseId: 'task-a',
        type: 'explore',
        description: 'Background research',
      },
      {
        turnId: 'turn-1',
        toolUseId: 'task-b',
        type: 'worker',
        description: 'Still running work',
      },
    ];
    const result = settleZombieSubagents(rows, [
      {
        type: 'explore',
        description: 'Background research',
        status: 'completed',
        toolUseCount: 7,
        durationMs: 123_000,
      },
      {
        type: 'worker',
        description: 'Still running work',
        status: 'running',
      },
    ]);

    expect(result.settled).toEqual([
      {
        row: rows[0],
        subagent: {
          type: 'explore',
          description: 'Background research',
          status: 'completed',
          toolUseCount: 7,
          durationMs: 123_000,
        },
      },
    ]);
    expect(result.pending).toEqual([rows[1]]);
  });

  it('pairs repeated identities newest-first like the turn-end reconcile', () => {
    const rows = ['task-1', 'task-2'].map((toolUseId) => ({
      turnId: 'turn-1',
      toolUseId,
      type: 'worker',
      description: 'Same delegation',
    }));
    const result = settleZombieSubagents(rows, [
      {
        type: 'worker',
        description: 'Same delegation',
        status: 'failed',
      },
      {
        type: 'worker',
        description: 'Same delegation',
        status: 'completed',
        toolUseCount: 2,
        durationMs: 8_000,
      },
    ]);

    // The newest row takes the newest ledger entry.
    expect(
      result.settled.map(({ row, subagent }) => [
        row.toolUseId,
        subagent.status,
      ]),
    ).toEqual([
      ['task-1', 'failed'],
      ['task-2', 'completed'],
    ]);
    expect(result.pending).toEqual([]);
  });

  it('never settles a running row with an older terminal entry of the same identity', () => {
    // The whole-session ledger: an old completed delegation from an
    // earlier turn plus the current one, still running. The live
    // entry accounts for the waiting row, so nothing settles.
    const rows = [
      {
        turnId: 'turn-2',
        toolUseId: 'task-now',
        type: 'explore',
        description: 'Repeated delegation',
      },
    ];
    const ledger = [
      {
        type: 'explore',
        description: 'Repeated delegation',
        status: 'completed' as const,
        toolUseCount: 3,
        durationMs: 60_000,
      },
      {
        type: 'explore',
        description: 'Repeated delegation',
        status: 'running' as const,
      },
    ];
    expect(settleZombieSubagents(rows, ledger)).toEqual({
      settled: [],
      pending: rows,
    });

    // Once the live entry reaches a terminal state, the row settles
    // with the newest terminal entry.
    const done = settleZombieSubagents(rows, [
      ledger[0]!,
      {
        type: 'explore',
        description: 'Repeated delegation',
        status: 'failed' as const,
      },
    ]);
    expect(done.settled).toEqual([
      {
        row: rows[0],
        subagent: {
          type: 'explore',
          description: 'Repeated delegation',
          status: 'failed',
        },
      },
    ]);
    expect(done.pending).toEqual([]);
  });

  it('keeps every row pending on an empty or non-matching ledger', () => {
    const rows = [
      {
        turnId: 'turn-1',
        toolUseId: 'task-a',
        type: 'explore',
        description: 'Background research',
      },
    ];
    expect(settleZombieSubagents(rows, [])).toEqual({
      settled: [],
      pending: rows,
    });
    expect(
      settleZombieSubagents(rows, [
        {
          type: 'other',
          description: 'Unrelated',
          status: 'completed',
        },
      ]),
    ).toEqual({ settled: [], pending: rows });
  });

  it('applies a settlement to the current activity state', () => {
    const state = delegatedState('task-bg', 'Background research');
    const settled = applySubagentSettlement(state, 'task-bg', {
      type: 'explore',
      description: 'Background research',
      status: 'completed',
      toolUseCount: 4,
      durationMs: 130_000,
    });
    expect(settled.tools.get('task-bg')?.subagent?.status).toBe(
      'completed',
    );
    // Unknown rows and rows without a delegation are no-ops.
    expect(
      applySubagentSettlement(state, 'missing', {
        type: 'explore',
        description: '',
        status: 'completed',
      }),
    ).toBe(state);
  });
});
