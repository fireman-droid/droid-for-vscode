import { describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  type HostToWebviewMessage,
} from '../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeSessionTarget,
} from '../runtime/DroidRuntime';
import type {
  RuntimeAvailability,
  RuntimeEvent,
} from '../runtime/runtimeEvents';
import type {
  RuntimeAskUserResult,
  RuntimeInteractionHandler,
  RuntimePermissionResult,
} from '../runtime/runtimeInteractions';
import type {
  SessionCatalog,
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import { DaemonAvailabilityError } from '../runtime/daemon/daemonConnection';
import type { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
import type { AttachmentSources } from './attachmentSources';
import type {
  FileDiffOpener,
  FileDiffOutcome,
} from './fileDiffOpener';
import type {
  OpenPathOutcome,
  PathOpener,
} from './pathOpener';
import type {
  PrototypePreviewOpener,
  PrototypePreviewOutcome,
} from './prototypePreview';
import type {
  ChangeStatsReader,
  FileChangeStat,
} from './changeStats';
import type { GitWorkflow } from './gitWorkflow';
import {
  createWorktreeSessionsFeature,
  type GitExec,
  type WorktreeSessionsFeature,
} from './worktreeSessions';
import type { ExternalUrlOpener } from './externalUrlOpener';
import { ChatController } from './ChatController';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  appendAcceptedUserPrompt,
  createHostTranscriptState,
} from './hostTranscriptState';

describe('ChatController', () => {
  it('initializes one runtime on repeated ready messages and keeps sequences monotonic', async () => {
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(createRuntime);

    ready(controller);
    ready(controller);

    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(runtime.initialize).toHaveBeenCalledOnce();
    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(messages.map(({ sequence }) => sequence)).toEqual(
      messages.map((_, index) => index),
    );
  });

  it('reports missing and untrusted workspaces without creating a runtime', () => {
    const createRuntime = vi.fn(() => createMockRuntime());
    const noWorkspace = createController(createRuntime, {
      cwd: null,
      trusted: true,
    });
    const untrusted = createController(createRuntime, {
      cwd: 'C:\\workspace',
      trusted: false,
    });

    ready(noWorkspace.controller);
    ready(untrusted.controller);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(noWorkspace.messages.at(-1)).toMatchObject({
      type: 'host.snapshot',
      sessionId: null,
      connection: {
        status: 'unavailable',
        message: 'Open a workspace folder to use DroidVisX.',
      },
    });
    expect(untrusted.messages.at(-1)).toMatchObject({
      type: 'host.snapshot',
      sessionId: null,
      connection: {
        status: 'unavailable',
        message: 'Trust this workspace to start the local Droid runtime.',
      },
    });
  });

  it('can retry startup after a workspace becomes available', async () => {
    const workspace: { cwd: string | null; trusted: boolean } = {
      cwd: null,
      trusted: true,
    };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
      'unavailable',
    );

    workspace.cwd = 'C:\\workspace';
    retry(controller, null);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
  });

  it('maps semantic runtime events to safe bridge messages', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'thinking-delta', text: 'Safe plan' };
      yield { type: 'thinking-complete', durationMs: null };
      yield { type: 'error' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Say hello');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant.delta',
          sessionId: 'session-1',
          turnId: 'turn-1',
          delta: 'Hello',
        }),
        expect.objectContaining({
          type: 'thinking.delta',
          delta: 'Safe plan',
          truncated: false,
        }),
        expect.objectContaining({
          type: 'thinking.complete',
          durationMs: null,
        }),
        expect.objectContaining({
          type: 'runtime.diagnostic',
          code: 'runtime-event-error',
          message:
            'Droid reported a runtime error while processing this turn.',
        }),
      ]),
    );
  });

  it('enters streaming before tool activity and projects safe progress', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield {
        type: 'tool-progress',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        updateKind: 'status',
      };
      yield {
        type: 'tool-result',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      };
      yield {
        type: 'tool-progress',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        updateKind: 'message',
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Read a file');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const activities = toolActivities(messages);
    expect(activities).toEqual([
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      }),
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 1,
        latestUpdateKind: 'status',
      }),
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 1,
        latestUpdateKind: 'status',
      }),
    ]);
    expect(
      messages.findIndex(
        (message) =>
          message.type === 'turn.state' &&
          message.status === 'streaming',
      ),
    ).toBeLessThan(
      messages.findIndex((message) => message.type === 'tool.activity'),
    );
  });

  it('caps assistant output and emits one safe truncation diagnostic', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'text-delta',
        text: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
      };
      yield { type: 'text-delta', text: '' };
      yield { type: 'text-delta', text: 'secret overflow' };
      yield { type: 'text-delta', text: 'more secret overflow' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Write');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const assistant = messages.filter(
      (message) => message.type === 'assistant.delta',
    );
    const diagnostics = messages.filter(
      (message) =>
        message.type === 'runtime.diagnostic' &&
        message.code === 'assistant-output-truncated',
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      delta: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message:
          'Assistant output exceeded the display limit and was truncated.',
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('secret overflow');
  });

  it('caps thinking output and emits truncation only once', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-delta',
        text: 'a'.repeat(MAX_THINKING_TEXT_LENGTH),
      };
      yield { type: 'thinking-delta', text: 'secret overflow' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const thinking = messages.filter(
      (message) => message.type === 'thinking.delta',
    );
    expect(thinking).toHaveLength(2);
    expect(thinking[0]).toMatchObject({
      delta: 'a'.repeat(MAX_THINKING_TEXT_LENGTH),
      truncated: false,
    });
    expect(thinking[1]).toMatchObject({
      delta: '',
      truncated: true,
    });
    expect(JSON.stringify(messages)).not.toContain('secret overflow');
  });

  it('uses non-idle working state to enter streaming and keeps idle silent', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'working-state', isWorking: false };
      yield { type: 'working-state', isWorking: true };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Work');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(turnStates(messages).map(({ status }) => status)).toEqual([
      'submitting',
      'streaming',
      'completed',
    ]);
    expect(
      messages.some(
        (message) =>
          message.type === 'assistant.delta' ||
          message.type === 'thinking.delta' ||
          message.type === 'thinking.complete' ||
          message.type === 'tool.activity' ||
          message.type === 'runtime.diagnostic',
      ),
    ).toBe(false);
  });

  it('does not enter streaming for idle working state alone', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'working-state', isWorking: false };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Wait');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(turnStates(messages).map(({ status }) => status)).toEqual([
      'submitting',
      'completed',
    ]);
  });

  it('fails execution outcomes with a safe retryable turn error', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        ...successfulTurn(),
        outcome: 'error_during_execution',
      };
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Run');

    await vi.waitFor(() => {
      expect(
        messages.find((message) => message.type === 'turn.error'),
      ).toMatchObject({
        code: 'runtime-execution-failed',
        retryable: true,
      });
    });
    expect(turnStates(messages).at(-1)?.status).toBe('failed');
  });

  it('makes stop idempotent and drops every late nonterminal event', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'before stop' };
      await release.promise;
      yield { type: 'text-delta', text: 'late sensitive text' };
      yield {
        type: 'thinking-delta',
        text: 'late sensitive thinking',
      };
      yield {
        type: 'tool-start',
        toolName: 'LateSensitiveTool',
        toolUseId: 'late-sensitive-id',
        action: 'Used Late Sensitive Tool',
      };
      yield { type: 'working-state', isWorking: true };
      yield { type: 'error' };
      yield {
        ...successfulTurn(),
        outcome: 'interrupted',
      };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'wrong-session', 'ignored', 'No');
    send(controller, 'session-1', 'turn-1', 'Start');
    send(controller, 'session-1', 'turn-2', 'Duplicate');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    stop(controller, 'wrong-session', 'turn-1');
    stop(controller, 'session-1', 'wrong-turn');
    stop(controller, 'session-1', 'turn-1');
    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();
    expect(runtime.interrupt).toHaveBeenCalledOnce();
    expect(
      messages.filter((message) => message.type === 'assistant.delta'),
    ).toHaveLength(1);
    expect(
      messages.some(
        (message) =>
          message.type === 'thinking.delta' ||
          message.type === 'tool.activity' ||
          message.type === 'runtime.diagnostic',
      ),
    ).toBe(false);
    expect(JSON.stringify(messages)).not.toContain('late sensitive');
    expect(JSON.stringify(messages)).not.toContain('LateSensitiveTool');
  });

  it('disposes a failed runtime before retrying and ignores its late cleanup', async () => {
    const disposed = deferred<void>();
    const first = createMockRuntime(async function* () {
      throw new Error('sensitive stream failure');
    });
    first.dispose.mockImplementation(() => disposed.promise);
    const second = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'wrong-session');
    retry(controller, 'session-1');
    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    disposed.resolve();
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
    expect(second.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
  });

  it('fails a stopped turn safely when interrupt rejects and drops late events', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'before stop' };
      await release.promise;
      yield { type: 'text-delta', text: 'late sensitive content' };
    });
    runtime.interrupt.mockRejectedValue(new Error('sensitive interrupt failure'));
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Start');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn.error',
          code: 'runtime-interrupt-failed',
          retryable: true,
        }),
      ]),
    );
    release.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(messages)).not.toContain('late sensitive content');
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive interrupt failure',
    );
  });

  it('reports cleanup failure and allows a later retry with a fresh runtime', async () => {
    const first = createMockRuntime(async function* () {
      throw new Error('stream failure');
    });
    first.dispose
      .mockRejectedValueOnce(new Error('sensitive cleanup failure'))
      .mockResolvedValueOnce();
    const second = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: {
          status: 'unavailable',
          message: 'The current Droid session could not be closed.',
        },
      });
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(JSON.stringify(messages)).not.toContain('sensitive cleanup failure');

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
  });

  it('does not create a replacement runtime when disposed during retry cleanup', async () => {
    const cleanup = deferred<void>();
    const first = createMockRuntime(async function* () {
      throw new Error('stream failure');
    });
    first.dispose.mockImplementation(() => cleanup.promise);
    const createRuntime = vi.fn(() => first);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'session-1');
    const disposal = controller.dispose();
    cleanup.resolve();
    await disposal;
    await Promise.resolve();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledOnce();
    const count = messages.length;
    ready(controller);
    retry(controller, null);
    expect(messages).toHaveLength(count);
  });

  it('keeps the session alive without listeners and disposes once', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    const detachedMessages: HostToWebviewMessage[] = [];
    const detached = controller.subscribe((message) => {
      detachedMessages.push(message);
    });
    detached.dispose();
    ready(controller);

    expect(runtime.initialize).toHaveBeenCalledOnce();
    expect(detachedMessages).toEqual([]);
    const firstDisposal = controller.dispose();
    const secondDisposal = controller.dispose();
    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    expect(runtime.dispose).toHaveBeenCalledOnce();

    const count = messages.length;
    ready(controller);
    expect(messages).toHaveLength(count);
  });

  it('drops an initialization result that arrives after disposal', async () => {
    const initialization = deferred<RuntimeAvailability>();
    const runtime = createMockRuntime();
    runtime.initialize.mockImplementation(() => initialization.promise);
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    const disposal = controller.dispose();
    initialization.resolve(available());
    await disposal;
    await Promise.resolve();

    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it('supplies the interaction handler before runtime creation and settles permission and AskUser', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let permissionResult!: RuntimePermissionResult;
    let askUserResult!: RuntimeAskUserResult;
    const runtime = createMockRuntime(async function* () {
      permissionResult = await interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
          {
            label: 'Edit plan',
            value: 'proceed_edit',
            requiresEditedSpec: true,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Review plan',
            editableSpecContent: '# Plan',
          },
        ],
      });
      askUserResult = await interactionHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 3,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes', 'No'],
            multiSelect: false,
          },
        ],
      });
      yield successfulTurn();
    });
    const createRuntime = vi.fn((handler: RuntimeInteractionHandler) => {
      interactionHandler = handler;
      return runtime;
    });
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    expect(createRuntime).toHaveBeenCalledWith(interactionHandler);

    send(controller, 'session-1', 'turn-1', 'Plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised',
    });
    const askUser = await waitForInteraction(messages, 'ask-user');
    controller.handleMessage({
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: askUser.request.requestId,
      cancelled: false,
      answers: [{ index: 3, answer: 'Yes' }],
    });

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(permissionResult).toEqual({
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised',
    });
    expect(askUserResult).toEqual({
      answers: [{ index: 3, answer: 'Yes' }],
    });
    expect(
      messages
        .filter((message) => message.type === 'interaction.closed')
        .map(({ requestId }) => requestId),
    ).toEqual([
      permission.request.requestId,
      askUser.request.requestId,
    ]);
  });

  it('replays every pending interaction after each ready with fresh monotonic sequences', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      void interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      void interactionHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');
    await vi.waitFor(() => {
      expect(interactionRequests(messages)).toHaveLength(2);
    });

    ready(controller);
    ready(controller);
    await vi.waitFor(() => {
      expect(
        interactionRequests(messages).map(
          ({ request }) => `${request.kind}:${request.requestId}`,
        ),
      ).toEqual([
        'permission:interaction-1',
        'ask-user:interaction-2',
        'permission:interaction-1',
        'ask-user:interaction-2',
        'permission:interaction-1',
        'ask-user:interaction-2',
      ]);
    });
    expect(messages.map(({ sequence }) => sequence)).toEqual(
      messages.map((_, index) => index),
    );

    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(
      messages.filter((message) => message.type === 'interaction.closed'),
    ).toHaveLength(2);
  });

  it('cancels pending turn interactions before interrupting on Stop', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let permission!: Promise<RuntimePermissionResult>;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      permission = interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => {
      await expect(permission).resolves.toEqual({
        selectedOption: 'cancel',
      });
      release.resolve();
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    await waitForInteraction(messages, 'permission');

    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });
    expect(runtime.interrupt).toHaveBeenCalledOnce();
    expect(
      messages.filter((message) => message.type === 'interaction.closed'),
    ).toHaveLength(1);
  });

  it('cancels pending interactions on terminal failure and retry replacement', async () => {
    let firstHandler!: RuntimeInteractionHandler;
    let pending!: Promise<RuntimeAskUserResult>;
    const first = createMockRuntime(async function* () {
      pending = firstHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      throw new Error('stream failed');
    });
    const replacementRelease = deferred<void>();
    const second = createMockRuntime(async function* () {
      await replacementRelease.promise;
      yield successfulTurn();
    });
    const createRuntime = vi
      .fn<(handler: RuntimeInteractionHandler) => MockRuntime>()
      .mockImplementationOnce((handler) => {
        firstHandler = handler;
        return first;
      })
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Ask');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });
    await expect(pending).resolves.toEqual({
      cancelled: true,
      answers: [],
    });

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
        'connected',
      );
    });
    expect(first.dispose).toHaveBeenCalledOnce();

    send(controller, 'session-1', 'turn-2', 'Replacement');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.turnId).toBe('turn-2');
    });
    const interactionCount = interactionRequests(messages).length;
    await expect(
      firstHandler.askUser({
        toolCallId: 'stale-ask',
        questions: [
          {
            index: 0,
            topic: 'Stale',
            question: 'Wrong runtime?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      }),
    ).resolves.toEqual({ cancelled: true, answers: [] });
    expect(interactionRequests(messages)).toHaveLength(interactionCount);
    replacementRelease.resolve();
  });

  it('settles every pending interaction when the controller is disposed', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let pending!: Promise<RuntimePermissionResult>;
    const never = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      pending = interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      await never.promise;
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    await waitForInteraction(messages, 'permission');

    await controller.dispose();

    await expect(pending).resolves.toEqual({
      selectedOption: 'cancel',
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('resumes only a catalog-validated recovered session and restores its transcript', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('complete'),
        'saved-turn',
        'Recovered prompt',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      historyStatus: 'partial',
      transcript: [
        expect.objectContaining({
          kind: 'user',
          text: 'Recovered prompt',
        }),
      ],
    });
  });

  it('emits an early connecting snapshot from the recovery checkpoint before runtime activation completes', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('complete'),
        'saved-turn',
        'Recovered prompt',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const activation = deferred<RuntimeAvailability>();
    const runtime = createMockRuntime();
    runtime.initialize.mockImplementation(() => activation.promise);
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);

    await vi.waitFor(() => {
      expect(snapshots(messages).length).toBeGreaterThan(0);
    });
    expect(snapshots(messages)[0]).toMatchObject({
      sessionId: 'saved-session',
      connection: { status: 'connecting' },
      transcript: [
        expect.objectContaining({
          kind: 'user',
          text: 'Recovered prompt',
        }),
      ],
    });

    // The early snapshot must not unlock mutating handlers.
    send(controller, 'saved-session', 'turn-early', 'too soon');
    expect(turnStates(messages)).toHaveLength(0);
    expect(runtime.sendTurn).not.toHaveBeenCalled();

    activation.resolve(available('saved-session'));
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      connection: { status: 'connected' },
    });
  });

  it('does not emit an early snapshot without a recovered checkpoint transcript', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages)[0]).toMatchObject({
      connection: { status: 'connected' },
    });
  });

  it('reconciles and persists public history with locally recovered content before activation commit', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'cached-turn',
        'Cached fallback',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const historyState = {
      transcript: [
        {
          id: 'user-history',
          kind: 'user' as const,
          text: 'Loaded old prompt',
        },
        {
          id: 'assistant-history',
          kind: 'assistant' as const,
          turnId: 'history-turn',
          text: 'Loaded old answer',
        },
      ],
      historyStatus: 'complete' as const,
      truncated: false,
    };
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state: historyState,
      })),
    };
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(history.loadHistory).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      historyStatus: 'partial',
      truncated: false,
      transcript: [
        { kind: 'user', text: 'Loaded old prompt' },
        { kind: 'assistant', text: 'Loaded old answer' },
        { kind: 'user', text: 'Cached fallback' },
      ],
    });
    expect(writeSession).toHaveBeenCalledWith(
      'saved-session',
      expect.objectContaining({
        historyStatus: 'partial',
        truncated: false,
        transcript: [
          ...historyState.transcript,
          expect.objectContaining({ text: 'Cached fallback' }),
        ],
      }),
    );
    expect(recovery.readSession('saved-session')).toMatchObject({
      historyStatus: 'partial',
      truncated: false,
      transcript: [
        ...historyState.transcript,
        expect.objectContaining({ text: 'Cached fallback' }),
      ],
    });
  });

  it('falls back to recovery when public old-session history is unavailable', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'cached-turn',
        'Cached fallback',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => {
        throw new Error('C:\\private\\raw-history-error');
      }),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'partial',
      transcript: [{ kind: 'user', text: 'Cached fallback' }],
    });
    expect(JSON.stringify(messages)).not.toContain('raw-history-error');
  });

  it('finishes temporary history loading before creating the resume runtime', async () => {
    const calls: string[] = [];
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => {
        calls.push('history-loaded-and-closed');
        return {
          status: 'available' as const,
          state: createHostTranscriptState('complete'),
        };
      }),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockImplementation(async () => {
      calls.push('runtime-initialized');
      return available('saved-session');
    });
    const { controller, messages } = createController(
      () => {
        calls.push('runtime-created');
        return runtime;
      },
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(calls).toEqual([
      'history-loaded-and-closed',
      'runtime-created',
      'runtime-initialized',
    ]);
  });

  it('rejects stale history after an exact workspace change without persisting or creating its candidate', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const staleHistory = deferred<{
      readonly status: 'available';
      readonly state: ReturnType<typeof createHostTranscriptState>;
    }>();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(() => staleHistory.promise),
    };
    const createRuntime = vi.fn(() => createMockRuntime());
    const catalog = createCatalog([catalogEntry('saved-session')]);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
      history,
    );

    ready(controller);
    await vi.waitFor(() => {
      expect(history.loadHistory).toHaveBeenCalledWith({
        cwd: 'C:\\workspace-a',
        sessionId: 'saved-session',
      });
    });
    workspace.cwd = 'C:\\workspace-b';
    workspace.trusted = false;
    staleHistory.resolve({
      status: 'available',
      state: {
        transcript: [
          {
            id: 'stale-user',
            kind: 'user',
            text: 'Must not persist',
          },
        ],
        historyStatus: 'complete',
        truncated: false,
      },
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        connection: {
          status: 'unavailable',
          message:
            'Trust this workspace to start the local Droid runtime.',
        },
      });
    });
    expect(history.loadHistory).toHaveBeenCalledOnce();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
    expect(recovery.readSession('saved-session')).toBeUndefined();
    await controller.dispose();
  });

  it('falls back to a new session when recovery is missing from the latest catalog', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('forged-or-stale');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('fresh-session'));
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('other-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(recovery.getSelectedSessionId()).toBe('fresh-session');
    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'complete',
      transcript: [],
    });
  });

  it('recovers cached transcript after controller recreation with the same persistence', async () => {
    const persistence = createMemoryPersistence();
    const firstRuntime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Persisted answer' };
      yield successfulTurn();
    });
    const firstRecovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const first = createController(
      () => firstRuntime,
      undefined,
      createCatalog([]),
      firstRecovery,
    );
    ready(first.controller);
    await waitForConnected(first.messages);
    send(
      first.controller,
      'session-1',
      'turn-persisted',
      'Persisted prompt',
    );
    await vi.waitFor(() => {
      expect(turnStates(first.messages).at(-1)?.status).toBe(
        'completed',
      );
    });
    await first.controller.dispose();

    const resumedRuntime = createMockRuntime();
    resumedRuntime.initialize.mockResolvedValue(available('session-1'));
    const second = createController(
      () => resumedRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );
    ready(second.controller);
    await waitForConnected(second.messages);

    expect(resumedRuntime.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(snapshots(second.messages).at(-1)?.transcript).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Persisted prompt',
      }),
      expect.objectContaining({
        kind: 'assistant',
        text: 'Persisted answer',
      }),
    ]);
  });

  it('creates a fresh runtime when catalog loading fails and reports history error', async () => {
    const runtime = createMockRuntime();
    const catalog = createCatalogResult({
      status: 'unavailable',
      reason: 'catalog-failed',
      message: 'sensitive backend failure',
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      catalog,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessions: {
        status: 'error',
        message: 'Saved Droid sessions could not be loaded.',
        items: [
          expect.objectContaining({
            id: 'session-1',
            active: true,
          }),
        ],
      },
    });
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive backend failure',
    );
  });

  it('snapshots the active transcript before replaying pending interactions on reload', async () => {
    let handler!: RuntimeInteractionHandler;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Current answer' };
      void handler.askUser({
        toolCallId: 'ask-current',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController((nextHandler) => {
      handler = nextHandler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Prompt');
    await waitForInteraction(messages, 'ask-user');
    const beforeReload = messages.length;

    ready(controller);
    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThan(beforeReload + 1);
    });

    const reloadMessages = messages.slice(beforeReload);
    expect(reloadMessages[0]).toMatchObject({
      type: 'host.snapshot',
      turn: { turnId: 'turn-1', status: 'streaming' },
      transcript: [
        expect.objectContaining({ kind: 'user', text: 'Prompt' }),
        expect.objectContaining({
          kind: 'assistant',
          text: 'Current answer',
        }),
      ],
    });
    expect(reloadMessages[1]).toMatchObject({
      type: 'interaction.request',
      request: { kind: 'ask-user' },
    });
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
  });

  it('marks an uncached external session unavailable then partial after an observed turn', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('external-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('external-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('external-session')]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'unavailable',
      transcript: [],
    });

    send(controller, 'external-session', 'turn-1', 'Observed');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.historyStatus).toBe('partial');
    });
  });

  it('preserves a recovered partial-history cache', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'partial-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'older-turn',
        'Cached fragment',
      ),
    );
    seed.selectSession('partial-session');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('partial-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('partial-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'partial',
      transcript: [
        expect.objectContaining({ text: 'Cached fragment' }),
      ],
    });
  });

  it('blocks session replacement during an active turn and rejects forged session ids', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const replacement = createMockRuntime();
    replacement.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(runtime)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');

    controller.handleMessage({ type: 'session.new' });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'forged-session',
    });

    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.diagnostic',
          code: 'session-operation-blocked',
        }),
      ]),
    );
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'forged-session',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-selection-invalid',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('creates a worktree session through the daemon and annotates the row', async () => {
    const initial = createMockRuntime();
    const replacement = Object.assign(createMockRuntime(), {
      // The daemon runs the session in the worktree, not the
      // requested workspace cwd.
      getSessionCwd: vi.fn(() => 'C:\\workspace-wt-main-wt'),
    });
    replacement.initialize.mockResolvedValue(available('wt-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      worktreeFeature({ branch: 'main-wt' }),
    );
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        snapshots(messages).at(-1)?.worktreeCreateAvailable,
      ).toBe(true);
    });

    controller.handleMessage({ type: 'worktree.createSession' });

    await vi.waitFor(() => {
      expect(replacement.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace',
        worktree: true,
      });
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'wt-session',
            active: true,
            worktree: {
              branch: 'main-wt',
              path: 'C:\\workspace-wt-main-wt',
            },
          }),
        ]),
      );
    });
  });

  it('fails worktree creation closed without the daemon feature', async () => {
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    // Process mode: no capability advertised, request answered with a
    // diagnostic instead of a silent plain session.
    expect(
      snapshots(messages).at(-1)?.worktreeCreateAvailable,
    ).toBeUndefined();
    controller.handleMessage({ type: 'worktree.createSession' });

    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'worktree-create-unavailable',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('withholds the worktree capability in non-git workspaces', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      worktreeFeature({ branch: 'main-wt', isGit: false }),
    );
    ready(controller);
    await waitForConnected(messages);

    expect(
      snapshots(messages).at(-1)?.worktreeCreateAvailable,
    ).toBeUndefined();
    controller.handleMessage({ type: 'worktree.createSession' });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'worktree-create-unavailable',
    });
  });

  it('lists registered worktree sessions from their worktree cwd', async () => {
    const feature = worktreeFeature({ branch: 'wt-branch' });
    await feature.store.record('C:\\workspace', 'wt-session', {
      branch: 'wt-branch',
      path: 'C:\\workspace-wt',
    });
    // The workspace catalog never returns worktree sessions; they
    // only list under their worktree cwd.
    const catalog: SessionCatalog = {
      listSessions: vi.fn(
        async (cwd: string): Promise<SessionCatalogResult> => ({
          status: 'available',
          sessions:
            cwd === 'C:\\workspace-wt'
              ? [catalogEntry('wt-session')]
              : [catalogEntry('session-1')],
        }),
      ),
    };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      feature,
    );
    ready(controller);
    await waitForConnected(messages);

    expect(catalog.listSessions).toHaveBeenCalledWith(
      'C:\\workspace-wt',
    );
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'session-1' }),
        expect.objectContaining({
          id: 'wt-session',
          worktree: { branch: 'wt-branch', path: 'C:\\workspace-wt' },
        }),
      ]),
    );
  });

  it('renames the active session through the runtime and retitles the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      rename: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    // Wrong session id is ignored.
    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-other',
      title: 'Ignored',
    });
    expect(runtime.rename).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: '  Fireworks demo  ',
    });
    expect(runtime.rename).toHaveBeenCalledWith('Fireworks demo');
    await vi.waitFor(() => {
      const snapshot = messages
        .filter(
          (message) => message.type === 'host.snapshot',
        )
        .at(-1);
      expect(snapshot).toMatchObject({
        sessions: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'session-1',
              title: 'Fireworks demo',
              active: true,
            }),
          ]),
        },
      });
    });
  });

  it('reports a safe diagnostic when the runtime cannot rename', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      rename: vi.fn(async () => {
        throw new Error('private SDK failure detail');
      }),
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'New title',
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-rename-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private SDK failure detail',
    );

    // A runtime without rename support reports unsupported.
    const bare = createMockRuntime();
    const second = createController(
      () => bare,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'New title',
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-rename-unsupported',
    });
  });

  it('writes a favorite through the catalog and re-lists the sessions', async () => {
    let favored = false;
    const writeFavorite = vi.fn(async (_id: string, favorite: boolean) => {
      favored = favorite;
      return true;
    });
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [
          catalogEntry('session-1'),
          { ...catalogEntry('session-2'), isFavorite: favored },
        ],
      })),
      writeFavorite,
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-2',
      favorite: true,
    });
    expect(writeFavorite).toHaveBeenCalledWith('session-2', true);
    await vi.waitFor(() => {
      const snapshot = messages
        .filter((message) => message.type === 'host.snapshot')
        .at(-1);
      expect(snapshot).toMatchObject({
        sessions: {
          status: 'ready',
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'session-2',
              isFavorite: true,
            }),
          ]),
        },
      });
    });
  });

  it('rejects favorite writes for unknown sessions and unsupported catalogs', async () => {
    const writeFavorite = vi.fn(async () => true);
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('session-1')],
      })),
      writeFavorite,
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'forged-session',
      favorite: true,
    });
    expect(writeFavorite).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-favorite-invalid',
    });

    // A catalog without a favorites writer reports unsupported.
    const second = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-favorite-unsupported',
    });
  });

  it('reports a safe diagnostic when the favorites file write fails', async () => {
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('session-1')],
      })),
      writeFavorite: vi.fn(async () => {
        throw new Error('C:\\Users\\person\\.factory\\.favorites');
      }),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-favorite-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('.favorites');
  });

  it('archives a session through the daemon and re-lists both catalogs', async () => {
    let archived = false;
    const daemon = {
      archive: vi.fn(async () => {
        archived = true;
        return true;
      }),
      listArchived: vi.fn(async () =>
        archived
          ? [
              {
                id: 'session-2',
                title: 'Session session-2',
                modifiedTime: '2026-01-02T03:04:05.000Z',
                archivedTime: '2026-01-03T03:04:05.000Z',
              },
            ]
          : [],
      ),
    };
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: archived
          ? [catalogEntry('session-1')]
          : [catalogEntry('session-1'), catalogEntry('session-2')],
      })),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });

    await vi.waitFor(() => {
      const archivedState = messages
        .filter((message) => message.type === 'session.archived')
        .at(-1);
      expect(archivedState).toMatchObject({
        archived: {
          status: 'ready',
          items: [expect.objectContaining({ id: 'session-2' })],
        },
      });
    });
    expect(daemon.archive).toHaveBeenCalledWith('session-2');
    const snapshot = messages
      .filter((message) => message.type === 'host.snapshot')
      .at(-1);
    expect(
      snapshot?.sessions.items.some(({ id }) => id === 'session-2'),
    ).toBe(false);
  });

  it('rejects archiving the active or unknown sessions and unsupported runtimes', async () => {
    const daemon = { archive: vi.fn() };
    const catalog = createCatalog([
      catalogEntry('session-1'),
      catalogEntry('session-2'),
    ]);
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-1',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-active',
    });

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'forged-session',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-invalid',
    });
    expect(daemon.archive).not.toHaveBeenCalled();

    // Without a daemon provider the feature reports unsupported.
    const second = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-unsupported',
    });
  });

  it('maps daemon availability failures to fixed sign-in guidance', async () => {
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new DaemonAvailabilityError(
          'not-logged-in',
          'C:\\Users\\person\\.factory\\auth-detail-must-not-leak',
        );
      },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-archive-failed',
        message: expect.stringContaining('Sign in'),
      });
    });
    expect(JSON.stringify(messages)).not.toContain('auth-detail');
  });

  it('restores an archived session and refreshes the archived list', async () => {
    let archived = true;
    const daemon = {
      unarchive: vi.fn(async () => {
        archived = false;
        return true;
      }),
      listArchived: vi.fn(async () =>
        archived
          ? [
              {
                id: 'session-9',
                title: 'Session session-9',
                modifiedTime: '2026-01-02T03:04:05.000Z',
                archivedTime: '2026-01-03T03:04:05.000Z',
              },
            ]
          : [],
      ),
    };
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: archived
          ? [catalogEntry('session-1')]
          : [catalogEntry('session-1'), catalogEntry('session-9')],
      })),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.unarchive',
      sessionId: 'session-9',
    });

    await vi.waitFor(() => {
      const archivedState = messages
        .filter((message) => message.type === 'session.archived')
        .at(-1);
      expect(archivedState).toMatchObject({
        archived: { status: 'ready', items: [] },
      });
    });
    expect(daemon.unarchive).toHaveBeenCalledWith('session-9');
    const snapshot = messages
      .filter((message) => message.type === 'host.snapshot')
      .at(-1);
    expect(
      snapshot?.sessions.items.some(({ id }) => id === 'session-9'),
    ).toBe(true);
  });

  it('answers an archived refresh with loading then ready states', async () => {
    const daemon = {
      listArchived: vi.fn(async () => [
        {
          id: 'session-8',
          title: 'Archived eight',
          modifiedTime: '2026-01-02T03:04:05.000Z',
          archivedTime: '2026-01-03T03:04:05.000Z',
        },
      ]),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.archivedRefresh' });

    await vi.waitFor(() => {
      const states = messages
        .filter((message) => message.type === 'session.archived')
        .map((message) => message.archived.status);
      expect(states).toEqual(['loading', 'ready']);
    });
    expect(daemon.listArchived).toHaveBeenCalledWith('C:\\workspace');
  });

  it('answers content searches and keeps daemon errors generic', async () => {
    const daemon = {
      search: vi.fn(async (query: string) => [
        {
          id: 'session-1',
          title: 'Hit one',
          modifiedTime: '2026-01-02T03:04:05.000Z',
          snippet: `matched ${query}`,
        },
      ]),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.search',
      query: 'refactor',
    });
    await vi.waitFor(() => {
      expect(
        messages
          .filter((message) => message.type === 'session.searchResults')
          .at(-1),
      ).toMatchObject({
        search: {
          status: 'ready',
          query: 'refactor',
          items: [expect.objectContaining({ id: 'session-1' })],
        },
      });
    });

    // A failing daemon search returns a fixed message, not SDK detail.
    daemon.search.mockRejectedValueOnce(
      new Error('ws://127.0.0.1:12345 payload-must-not-leak'),
    );
    controller.handleMessage({
      type: 'session.search',
      query: 'second',
    });
    await vi.waitFor(() => {
      expect(
        messages
          .filter((message) => message.type === 'session.searchResults')
          .at(-1),
      ).toMatchObject({
        search: { status: 'error', query: 'second' },
      });
    });
    expect(JSON.stringify(messages)).not.toContain('payload-must-not-leak');
  });

  it('lists skills on request and re-lists after a toggle', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listSkills: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: false,
            userInvocable: true,
          },
        ]),
      setSkillDisabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'ready',
        items: [{ name: 'code-review', enabled: true }],
      });
    });
    expect(skillsMessages(messages)[0]?.skills.status).toBe('loading');

    controller.handleMessage({
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 'code-review',
      disabled: true,
    });
    expect(runtime.setSkillDisabled).toHaveBeenCalledWith(
      'code-review',
      true,
    );
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'ready',
        items: [{ name: 'code-review', enabled: false }],
      });
    });

    // Wrong session id is ignored entirely.
    const before = skillsMessages(messages).length;
    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-other',
    });
    expect(skillsMessages(messages)).toHaveLength(before);
  });

  it('reports unsupported and failed skill operations safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    expect(
      skillsMessages(unsupported.messages).at(-1)?.skills,
    ).toMatchObject({ status: 'unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      listSkills: vi.fn(async () => {
        throw new Error('private skill failure');
      }),
      setSkillDisabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'error',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private skill failure',
    );
  });

  it('lists custom commands on request and records recents on send', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listCommands: vi.fn(async () => [
        {
          name: 'deploy',
          description: 'Deploys the branch.',
          argumentHint: '<env>',
          isExecutable: false,
        },
        {
          name: 'triage',
          description: null,
          argumentHint: null,
          isExecutable: true,
        },
      ]),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    expect(commandsMessages(messages)[0]?.commands).toMatchObject({
      status: 'loading',
      items: [],
      recent: [],
    });
    await vi.waitFor(() => {
      expect(commandsMessages(messages).at(-1)?.commands).toMatchObject({
        status: 'ready',
        items: [{ name: 'deploy' }, { name: 'triage' }],
        recent: [],
      });
    });

    // Sending a cached command (case-insensitively) records the
    // canonical name and re-broadcasts the catalog.
    send(controller, 'session-1', 'turn-1', '/Deploy prod');
    const afterSend = commandsMessages(messages).at(-1)?.commands;
    expect(afterSend).toMatchObject({
      status: 'ready',
      recent: ['deploy'],
    });
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    // Unknown commands and plain text do not touch the recent list.
    const count = commandsMessages(messages).length;
    send(controller, 'session-1', 'turn-2', '/nope now');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    send(controller, 'session-1', 'turn-3', 'plain text');
    expect(commandsMessages(messages)).toHaveLength(count);

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-other',
    });
    expect(commandsMessages(messages)).toHaveLength(count);
    expect(runtime.listCommands).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported and failed command loads safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    expect(
      commandsMessages(unsupported.messages).at(-1)?.commands,
    ).toMatchObject({ status: 'unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      listCommands: vi.fn(async () => {
        throw new Error('private command failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(commandsMessages(messages).at(-1)?.commands).toMatchObject({
        status: 'error',
        items: [],
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private command failure',
    );
  });

  it('lists MCP servers on request and re-lists after a toggle', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'linear',
            status: 'connected',
            toolCount: 1,
            requiresAuth: false,
            tools: [
              {
                name: 'list-issues',
                description: 'Lists issues.',
                enabled: true,
                readOnly: true,
              },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'linear',
            status: 'disabled',
            toolCount: 1,
            requiresAuth: false,
            tools: [],
          },
        ]),
      setMcpServerEnabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [
          {
            name: 'linear',
            status: 'connected',
            tools: [{ name: 'list-issues', readOnly: true }],
          },
        ],
      });
    });
    expect(mcpMessages(messages)[0]?.mcp.status).toBe('loading');

    controller.handleMessage({
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'linear',
      enabled: false,
    });
    expect(runtime.setMcpServerEnabled).toHaveBeenCalledWith(
      'linear',
      false,
    );
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [{ name: 'linear', status: 'disabled' }],
      });
    });

    // Wrong session id is ignored entirely.
    const before = mcpMessages(messages).length;
    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-other',
    });
    expect(mcpMessages(messages)).toHaveLength(before);
  });

  it('reports unsupported and failed MCP operations safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    expect(mcpMessages(unsupported.messages).at(-1)?.mcp).toMatchObject({
      status: 'unsupported',
    });

    const failing = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => {
        throw new Error('private mcp failure');
      }),
      setMcpServerEnabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private mcp failure');
  });

  it('adds and removes MCP servers, then rebroadcasts the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'local-tools',
            status: 'connected',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
        ])
        .mockResolvedValueOnce([]),
      addMcpServer: vi.fn(async () => {}),
      removeMcpServer: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
    expect(runtime.addMcpServer).toHaveBeenCalledWith({
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [{ name: 'local-tools' }],
      });
    });

    controller.handleMessage({
      type: 'mcp.server.remove',
      sessionId: 'session-1',
      name: 'local-tools',
    });
    expect(runtime.removeMcpServer).toHaveBeenCalledWith('local-tools');
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [],
      });
    });

    // A failing add surfaces as a safe error state that still carries
    // the freshly re-read catalog instead of blanking the list.
    runtime.addMcpServer.mockRejectedValueOnce(
      new Error('private add failure'),
    );
    runtime.listMcpServers.mockResolvedValueOnce([
      {
        name: 'survivor',
        status: 'connected',
        toolCount: 0,
        requiresAuth: false,
        hasAuthTokens: false,
        tools: [],
      },
    ]);
    controller.handleMessage({
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'broken',
      serverType: 'http',
      url: 'https://example.com/mcp',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
        items: [{ name: 'survivor' }],
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private add failure');
  });

  it('fast-fails MCP auth without an OAuth URL and frees the flow', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      authenticateMcpServer: vi.fn(async () => ({ authUrl: null })),
    });
    const opened: string[] = [];
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        openExternal: async (url) => {
          opened.push(url);
          return true;
        },
      },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    await vi.waitFor(() => {
      expect(mcpAuthMessages(messages).map(({ phase }) => phase)).toEqual([
        'started',
        'error',
      ]);
    });
    expect(mcpAuthMessages(messages).at(-1)?.message).toContain(
      'already be authenticated',
    );
    expect(opened).toEqual([]);
    // The flow ended, so the list refreshes and a new attempt is accepted.
    await vi.waitFor(() => {
      expect(runtime.listMcpServers).toHaveBeenCalled();
    });
    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(2);
  });

  it('compacts the session, adopts the continuation, and reloads its transcript', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      compact: vi.fn(async () => ({
        sessionId: 'session-compacted',
        removedCount: 5,
      })),
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async ({ sessionId }) =>
        sessionId === 'session-compacted'
          ? {
              status: 'available' as const,
              state: {
                transcript: [
                  {
                    id: 'summary-1',
                    kind: 'assistant' as const,
                    turnId: 'summary-turn',
                    text: 'Summary of earlier work',
                  },
                ],
                historyStatus: 'complete' as const,
                truncated: false,
              },
            }
          : {
              status: 'unavailable' as const,
              reason: 'history-failed' as const,
              message:
                'Saved Droid session history could not be loaded.' as const,
            },
      ),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-compacted',
        transcript: [{ kind: 'assistant', text: 'Summary of earlier work' }],
      });
    });
    expect(runtime.compact).toHaveBeenCalledOnce();
    expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
      severity: 'info',
      code: 'session-compacted',
      message: expect.stringContaining('5'),
      // The pre-compaction session backs "View full history".
      relatedSessionId: 'session-1',
    });
    // The compacted session stays selectable next to the continuation:
    // its file keeps the full pre-compaction history on disk.
    const sessions = snapshots(messages).at(-1)!.sessions;
    expect(
      sessions.items.filter(({ id }) => id === 'session-1'),
    ).toHaveLength(1);
    expect(sessions.items.at(-1)).toMatchObject({
      id: 'session-compacted',
      active: true,
    });

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-other',
    });
    expect(runtime.compact).toHaveBeenCalledOnce();
  });

  it('opens a native diff for validated tool paths and reports failures', async () => {
    const openDiff = vi.fn(
      async (): Promise<FileDiffOutcome> => 'opened-diff',
    );
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      { openDiff },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      path: 'src/app.ts',
    });
    await vi.waitFor(() => {
      expect(openDiff).toHaveBeenCalledWith('src/app.ts');
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'file-diff-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-other',
      path: 'src/app.ts',
    });
    expect(openDiff).toHaveBeenCalledOnce();

    // A failed open surfaces a bounded warning diagnostic.
    openDiff.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      path: 'src/missing.ts',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'file-diff-failed',
      });
    });
  });

  it('previews validated prototype paths and reports failures', async () => {
    const openPreview = vi.fn(
      async (): Promise<PrototypePreviewOutcome> => 'opened',
    );
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { openPreview },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'prototypes/dashboard.html',
    });
    await vi.waitFor(() => {
      expect(openPreview).toHaveBeenCalledWith('prototypes/dashboard.html');
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'preview-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-other',
      path: 'prototypes/dashboard.html',
    });
    expect(openPreview).toHaveBeenCalledOnce();

    // A failed preview surfaces a bounded warning diagnostic.
    openPreview.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'prototypes/missing.html',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'preview-failed',
      });
    });
  });

  it('answers git.requestStatus and routes git.commit through the workflow', async () => {
    const files = [
      {
        path: 'src/app.ts',
        status: 'modified',
        staged: false,
        inTurn: false,
      },
    ] as const;
    const status = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['status']>>
      > => ({ available: true, branch: 'main', files }),
    );
    const commit = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['commit']>>
      > => ({ ok: true, hash: 'abc1234' }),
    );
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { status, commit },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        branch: 'main',
        files: [expect.objectContaining({ path: 'src/app.ts' })],
      });
    });
    expect(status).toHaveBeenCalledWith('C:\\workspace', new Set());
    expect(
      lastMessage(messages, 'git.status'),
    ).not.toHaveProperty('unavailableReason');

    // Wrong session requests never reach the workflow.
    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-other',
    });
    expect(status).toHaveBeenCalledOnce();

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'feat: add app\n\nBody detail.',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
        sessionId: 'session-1',
        ok: true,
        hash: 'abc1234',
        subject: 'feat: add app',
      });
    });
    expect(commit).toHaveBeenCalledWith(
      'C:\\workspace',
      ['src/app.ts'],
      'feat: add app\n\nBody detail.',
    );
  });

  it('reports git unavailability and commit failures', async () => {
    const status = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['status']>>
      > => ({ available: false, reason: 'no-repository' }),
    );
    const commit = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['commit']>>
      > => ({ ok: false, error: 'pre-commit hook rejected the commit' }),
    );
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { status, commit },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        branch: null,
        files: [],
        unavailableReason: 'no-repository',
      });
    });

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'feat: add app',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
        ok: false,
        error: 'pre-commit hook rejected the commit',
      });
    });
  });

  it('degrades git requests to unavailable without an injected workflow', async () => {
    const { controller, messages } = createController(() =>
      createMockRuntime(),
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        unavailableReason: 'no-git-extension',
      });
    });
  });

  it('opens clicked transcript paths and reports failures', async () => {
    const openPath = vi.fn(
      async (): Promise<OpenPathOutcome> => 'opened',
    );
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { openPath },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'D:\\E\\artifacts\\简历.pdf',
    });
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith(
        'D:\\E\\artifacts\\简历.pdf',
        undefined,
        undefined,
      );
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'open-path-failed',
      ),
    ).toHaveLength(0);

    // Line and column ride along for text targets.
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/extension/ChatController.ts',
      line: 12,
      column: 3,
    });
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith(
        'src/extension/ChatController.ts',
        12,
        3,
      );
    });

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-other',
      path: 'src/app.ts',
    });
    expect(openPath).toHaveBeenCalledTimes(2);

    // A failed open surfaces a bounded warning diagnostic.
    openPath.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'D:\\missing\\file.txt',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'open-path-failed',
      });
    });
  });

  it('publishes a per-turn changes summary with git line stats', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        filePath: 'src/app.ts',
      };
      yield {
        type: 'tool-result',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        isError: false,
      };
      yield {
        type: 'tool-start',
        toolName: 'Create',
        toolUseId: 'tool-2',
        action: 'Created workspace files',
        filePath: 'docs/new.md',
      };
      yield {
        type: 'tool-result',
        toolName: 'Create',
        toolUseId: 'tool-2',
        action: 'Created workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 3, deletions: 1 }]]),
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      { read },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Change files');
    await vi.waitFor(() => {
      expect(
        messages.find((message) => message.type === 'turn.changes'),
      ).toBeDefined();
    });

    // Untracked files keep null stats; order follows tool order.
    expect(read).toHaveBeenCalledWith(['src/app.ts', 'docs/new.md']);
    expect(
      messages.find((message) => message.type === 'turn.changes'),
    ).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        { path: 'src/app.ts', additions: 3, deletions: 1 },
        { path: 'docs/new.md', additions: null, deletions: null },
      ],
    });
  });

  it('skips the changes summary when no tool named a workspace file', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield {
        type: 'tool-result',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> => new Map(),
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      { read },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Read only');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(read).not.toHaveBeenCalled();
    expect(
      messages.find((message) => message.type === 'turn.changes'),
    ).toBeUndefined();
  });

  it('forks the session, adopts the copy, and keeps the original in the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      fork: vi.fn(async () => ({ sessionId: 'session-fork' })),
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async ({ sessionId }) =>
        sessionId === 'session-fork'
          ? {
              status: 'available' as const,
              state: {
                transcript: [
                  {
                    id: 'copied-1',
                    kind: 'user' as const,
                    text: 'Original question',
                  },
                ],
                historyStatus: 'complete' as const,
                truncated: false,
              },
            }
          : {
              status: 'unavailable' as const,
              reason: 'history-failed' as const,
              message:
                'Saved Droid session history could not be loaded.' as const,
            },
      ),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-fork',
        transcript: [{ kind: 'user', text: 'Original question' }],
      });
    });
    expect(runtime.fork).toHaveBeenCalledOnce();
    expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
      severity: 'info',
      code: 'session-forked',
    });
    // Unlike compaction, the forked-from session stays selectable.
    const sessions = snapshots(messages).at(-1)!.sessions;
    expect(
      sessions.items.filter(({ id }) => id === 'session-1'),
    ).toHaveLength(1);
    expect(sessions.items.at(-1)).toMatchObject({
      id: 'session-fork',
      active: true,
      title: expect.stringContaining('(fork)'),
    });

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-other',
    });
    expect(runtime.fork).toHaveBeenCalledOnce();
  });

  it('reports unsupported and failed forking safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    expect(
      lastMessage(unsupported.messages, 'runtime.diagnostic'),
    ).toMatchObject({ code: 'session-fork-unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      fork: vi.fn(async () => {
        throw new Error('private fork failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'session-fork-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private fork failure',
    );
  });

  it('reports unsupported and failed compaction safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    expect(
      lastMessage(unsupported.messages, 'runtime.diagnostic'),
    ).toMatchObject({ code: 'session-compact-unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      compact: vi.fn(async () => {
        throw new Error('private compaction failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'session-compact-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private compaction failure',
    );
  });

  it('stages picked attachments, sends them with the next turn, then clears', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'shot.png',
            data: 'aW1n',
            mediaType: 'image/png' as const,
            sizeBytes: 3,
            truncated: false,
          },
          {
            kind: 'text' as const,
            name: 'notes.md',
            data: 'hello',
            sizeBytes: 5,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.pick',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toHaveLength(2);
    });
    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged[0]).toMatchObject({
      kind: 'image',
      name: 'shot.png',
      truncated: false,
    });

    // Removing one staged attachment keeps the other.
    controller.handleMessage({
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: staged[1]!.id,
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toEqual([staged[0]]);

    send(controller, 'session-1', 'turn-1', 'describe this');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith('describe this', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    // Attachments are consumed by the send.
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(0);
    // The image bytes cross the Bridge exactly once: as the bounded
    // user-origin transcript echo, never inside attachment metadata.
    const imageEchoes = messages.filter(
      (message) => message.type === 'transcript.image',
    );
    expect(imageEchoes).toHaveLength(1);
    expect(imageEchoes[0]).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      item: {
        kind: 'image',
        origin: 'user',
        mediaType: 'image/png',
        data: 'aW1n',
        generated: false,
        byteLength: 3,
      },
    });
    expect(
      JSON.stringify(
        messages.filter((message) => message.type !== 'transcript.image'),
      ),
    ).not.toContain('aW1n');
  });

  it('stages dropped/pasted images via attachment.addImage and rejects oversized ones', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'pasted-image.png',
      mediaType: 'image/png',
      dataBase64: 'aW1n',
    });
    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      kind: 'image',
      name: 'pasted-image.png',
      sizeBytes: 3,
      truncated: false,
    });

    // An image decoding above the 4 MB cap is rejected with a
    // structured diagnostic and stages nothing.
    controller.handleMessage({
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'huge.png',
      mediaType: 'image/png',
      dataBase64: 'A'.repeat(5_592_408),
    });
    expect(attachmentsMessages(messages).at(-1)?.attachments).toEqual(
      staged,
    );
    const diagnostics = messages.filter(
      (message) => message.type === 'runtime.diagnostic',
    );
    expect(JSON.stringify(diagnostics.at(-1))).toContain('too large');

    send(controller, 'session-1', 'turn-1', 'what is this?');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith('what is this?', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(0);
  });

  it('stages dropped file URIs inside the workspace and reports outside ones', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async (path: string) => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: path.split('/').at(-1) ?? path,
            data: 'file body',
            sizeBytes: 9,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: [
        'file:///C:/workspace/src/a.ts',
        'file:///C:/elsewhere/outside.ts',
      ],
    });

    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'a.ts' }]);
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledOnce();
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith('src/a.ts');
    const diagnostics = messages.filter(
      (message) => message.type === 'runtime.diagnostic',
    );
    expect(JSON.stringify(diagnostics)).toContain(
      'inside the current workspace',
    );
  });

  it('stages dropped text files with webview-read content', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'dropped body',
      truncated: true,
    });

    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged).toMatchObject([
      {
        kind: 'text',
        name: 'notes.txt',
        sizeBytes: 12,
        truncated: true,
      },
    ]);

    send(controller, 'session-1', 'turn-1', 'summarize the file');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith(
        'summarize the file',
        [
          expect.objectContaining({
            kind: 'text',
            name: 'notes.txt',
            data: 'dropped body',
          }),
        ],
      );
    });
  });

  it('echoes sent chips, stages edits per message, and resends from the edit stage', async () => {
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'user-message', messageId: 'sdk-message-1' };
        yield successfulTurn();
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'shot.png',
            data: 'aW1n',
            mediaType: 'image/png' as const,
            sizeBytes: 3,
            truncated: false,
          },
          {
            kind: 'text' as const,
            name: 'notes.md',
            data: 'hello',
            sizeBytes: 5,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.pick',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(attachmentsMessages(messages).at(-1)?.attachments).toHaveLength(
        2,
      );
    });
    send(controller, 'session-1', 'turn-1', 'first prompt');
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'user.message-meta')).toMatchObject({
        messageId: 'sdk-message-1',
      });
      expect(lastMessage(messages, 'turn.state')?.status).toBe('completed');
    });

    // The snapshot user item echoes only non-image chips; the image is
    // its own user-echo transcript item. A repeated ready re-emits the
    // current snapshot.
    ready(controller);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'host.snapshot')?.transcript.find(
          (item) => item.kind === 'user',
        ),
      ).toMatchObject({
        text: 'first prompt',
        attachments: [{ kind: 'text', name: 'notes.md', sizeBytes: 5 }],
      });
    });

    // Entering edit mode prefills the edit stage from the retention
    // area with restorable payloads.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
    });
    const editState = lastMessage(messages, 'session.editAttachments')!;
    expect(editState.messageId).toBe('sdk-message-1');
    expect(editState.attachments).toMatchObject([
      { kind: 'image', name: 'shot.png', restorable: true },
      { kind: 'text', name: 'notes.md', restorable: true },
    ]);

    // Edit-stage removal targets the edit stage, not the composer.
    controller.handleMessage({
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: editState.attachments[1]!.id,
      stage: 'edit',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([{ kind: 'image', restorable: true }]);

    // Resending consumes the edit stage: kept originals travel with the
    // forked send while the composer stage stays untouched.
    controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited prompt',
    });
    await vi.waitFor(() => {
      expect(runtime.rewind).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'sdk-message-1' }),
      );
      expect(runtime.sendTurn).toHaveBeenLastCalledWith('edited prompt', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    const forkSnapshot = lastMessage(messages, 'host.snapshot')!;
    expect(forkSnapshot.sessionId).toBe('fork-1');
    expect(
      forkSnapshot.transcript.find((item) => item.kind === 'user'),
    ).toMatchObject({ text: 'edited prompt' });
  });

  it('rejects edit-resend with structured reasons', async () => {
    // A runtime without rewind: structured 'unsupported'.
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited',
    });
    expect(
      lastMessage(unsupported.messages, 'turn.editResendRejected'),
    ).toMatchObject({
      messageId: 'sdk-message-1',
      reason: 'unsupported',
    });

    // An active turn: structured 'busy'.
    const hanging = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'user-message', messageId: 'sdk-message-1' };
        await new Promise(() => {});
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    const busy = createController(() => hanging);
    ready(busy.controller);
    await waitForConnected(busy.messages);
    send(busy.controller, 'session-1', 'turn-1', 'first prompt');
    await vi.waitFor(() => {
      expect(
        lastMessage(busy.messages, 'user.message-meta'),
      ).toMatchObject({ messageId: 'sdk-message-1' });
    });
    busy.controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited',
    });
    expect(
      lastMessage(busy.messages, 'turn.editResendRejected'),
    ).toMatchObject({ messageId: 'sdk-message-1', reason: 'busy' });
    expect(hanging.rewind).not.toHaveBeenCalled();
  });

  it('evicts retained payloads by byte budget and marks stale chips unrestorable', async () => {
    let sendIndex = 0;
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        sendIndex += 1;
        yield {
          type: 'user-message',
          messageId: `sdk-message-${sendIndex}`,
        };
        yield successfulTurn();
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    // Each send carries one ~20 MB text payload, so the second send
    // pushes the 32 MB retention budget over and evicts the first.
    const bigData = 'a'.repeat(20 * 1024 * 1024);
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: 'big.md',
            data: bigData,
            sizeBytes: bigData.length,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    for (const turn of [1, 2]) {
      controller.handleMessage({
        type: 'attachment.pick',
        sessionId: 'session-1',
      });
      await vi.waitFor(() => {
        expect(
          attachmentsMessages(messages).at(-1)?.attachments,
        ).toHaveLength(1);
      });
      send(controller, 'session-1', `turn-${turn}`, `prompt ${turn}`);
      await vi.waitFor(() => {
        expect(
          lastMessage(messages, 'user.message-meta'),
        ).toMatchObject({ messageId: `sdk-message-${turn}` });
        expect(lastMessage(messages, 'turn.state')?.status).toBe(
          'completed',
        );
      });
    }

    // The first message's payload was evicted: its chip is only
    // metadata and cannot be resent.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([
      { kind: 'text', name: 'big.md', restorable: false },
    ]);

    // The second message's payload is still retained.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-2',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([
      { kind: 'text', name: 'big.md', restorable: true },
    ]);
  });

  it('runs the MCP browser auth flow and refreshes the list on success', async () => {
    let completed:
      | ((outcome: 'success' | 'cancelled' | 'failed') => void)
      | null = null;
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      setMcpServerEnabled: vi.fn(async () => {}),
      authenticateMcpServer: vi.fn(
        async (
          _name: string,
          onCompleted: (
            outcome: 'success' | 'cancelled' | 'failed',
          ) => void,
        ) => {
          completed = onCompleted;
          return { authUrl: 'https://auth.example/flow' };
        },
      ),
    });
    const opened: string[] = [];
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        openExternal: async (url) => {
          opened.push(url);
          return true;
        },
      },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    await vi.waitFor(() => {
      expect(mcpAuthMessages(messages).map(({ phase }) => phase)).toEqual([
        'started',
        'browser',
      ]);
    });
    expect(opened).toEqual(['https://auth.example/flow']);
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(1);

    // A second request while one flow is pending is ignored.
    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'linear',
    });
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(1);

    completed!('success');
    await vi.waitFor(() => {
      expect(mcpAuthMessages(messages).at(-1)).toMatchObject({
        serverName: 'sentry',
        phase: 'success',
      });
    });
    // Success refreshes the MCP catalog.
    await vi.waitFor(() => {
      expect(runtime.listMcpServers).toHaveBeenCalled();
    });

    // A runtime without the capability answers with an error phase.
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    expect(mcpAuthMessages(unsupported.messages).at(-1)).toMatchObject({
      serverName: 'sentry',
      phase: 'error',
    });
  });

  it('answers rewind info requests with file-impact counts', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      getRewindInfo: vi.fn(async () => ({
        restorableCount: 2,
        createdCount: 1,
      })),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'rewind.info',
      sessionId: 'session-1',
      messageId: 'sdk-msg-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'rewind.info')).toMatchObject({
        sessionId: 'session-1',
        messageId: 'sdk-msg-1',
        restorableCount: 2,
        createdCount: 1,
      });
    });

    // Requests for another session are ignored.
    controller.handleMessage({
      type: 'rewind.info',
      sessionId: 'session-other',
      messageId: 'sdk-msg-1',
    });
    expect(runtime.getRewindInfo).toHaveBeenCalledTimes(1);
  });

  it('answers workspace file searches and stages @-mentioned files', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => [
        'src/webview/assistant/Thread.tsx',
        'src/webview/assistant/Thread.test.tsx',
      ]),
      readWorkspaceFile: vi.fn(async (path: string) => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: path.split('/').at(-1) ?? path,
            data: 'contents',
            sizeBytes: 8,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'file-search-1',
      query: 'Thread',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'workspace.files')).toMatchObject({
        requestId: 'file-search-1',
        files: [
          'src/webview/assistant/Thread.tsx',
          'src/webview/assistant/Thread.test.tsx',
        ],
      });
    });
    expect(sources.searchWorkspaceFiles).toHaveBeenCalledWith(
      'Thread',
      20,
    );

    // Blank queries answer immediately without touching the sources.
    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'file-search-2',
      query: '   ',
    });
    expect(lastMessage(messages, 'workspace.files')).toMatchObject({
      requestId: 'file-search-2',
      status: 'ok',
      files: [],
    });

    // Guarded requests still settle with an explicit empty reply so
    // the mention popup never hangs on "Searching...".
    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-other',
      requestId: 'file-search-3',
      query: 'Thread',
    });
    expect(lastMessage(messages, 'workspace.files')).toMatchObject({
      sessionId: 'session-other',
      requestId: 'file-search-3',
      status: 'ok',
      files: [],
    });

    controller.handleMessage({
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: 'src/webview/assistant/Thread.tsx',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'Thread.tsx' }]);
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith(
      'src/webview/assistant/Thread.tsx',
    );
  });

  it('serves markdown-referenced workspace images and refuses escapes', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'plot.png',
            data: 'aGk=',
            mediaType: 'image/png' as const,
            sizeBytes: 2,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'out/plot.png',
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'workspace.imageData'),
      ).toMatchObject({
        path: 'out/plot.png',
        status: 'ok',
        mediaType: 'image/png',
        data: 'aGk=',
      });
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith(
      'out/plot.png',
    );

    // Absolute references inside the workspace rebase to relative
    // reads; the reply still carries the path as written.
    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'C:\\workspace\\out\\chart.png',
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'workspace.imageData'),
      ).toMatchObject({
        path: 'C:\\workspace\\out\\chart.png',
        status: 'ok',
      });
    });
    expect(sources.readWorkspaceFile).toHaveBeenLastCalledWith(
      'out/chart.png',
    );

    // Escaping the workspace answers not-found without touching disk.
    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'C:\\elsewhere\\secret.png',
    });
    expect(lastMessage(messages, 'workspace.imageData')).toMatchObject({
      path: 'C:\\elsewhere\\secret.png',
      status: 'not-found',
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledTimes(2);
  });

  it('labels editor captures and reports empty selections', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({
        status: 'captured' as const,
        item: {
          kind: 'text' as const,
          name: 'main.ts',
          data: 'const x = 1;',
          sizeBytes: 12,
          truncated: false,
        },
      })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addEditor',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'editor', name: 'main.ts' }]);
    });

    controller.handleMessage({
      type: 'attachment.addSelection',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'attachment-empty',
      });
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(1);

    // Wrong-session attachment requests are ignored.
    const before = attachmentsMessages(messages).length;
    controller.handleMessage({
      type: 'attachment.addEditor',
      sessionId: 'session-other',
    });
    expect(attachmentsMessages(messages)).toHaveLength(before);
  });

  it('stages problems as text and reports empty git changes', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({
        status: 'captured' as const,
        item: {
          kind: 'text' as const,
          name: 'Problems',
          data: 'src/a.ts:3 [error] Unexpected token',
          sizeBytes: 35,
          truncated: false,
        },
      })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addProblems',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'Problems' }]);
    });

    controller.handleMessage({
      type: 'attachment.addGitChanges',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'attachment-empty',
        message: 'There are no uncommitted git changes to attach.',
      });
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(1);
  });

  it('clears stale catalog rows before loading a changed workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('a-only')]
            : [catalogEntry('b-only')],
      })),
    };
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a-only' }),
      ]),
    );

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'a-only',
    });

    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      sessions: { status: 'loading', items: [] },
    });
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
        status: 'ready',
        items: [
          expect.objectContaining({
            id: 'b-only',
            active: false,
          }),
        ],
      });
    });
    expect(runtime.initialize).toHaveBeenCalledTimes(1);
    expect(runtime.initialize).not.toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace-b',
      sessionId: 'a-only',
    });
  });

  it('discards a deferred catalog result after the workspace changes', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const staleRefresh = deferred<SessionCatalogResult>();
    const catalog = {
      listSessions: vi
        .fn<(cwd: string) => Promise<SessionCatalogResult>>()
        .mockResolvedValueOnce({
          status: 'available',
          sessions: [catalogEntry('a-existing')],
        })
        .mockImplementationOnce(() => staleRefresh.promise)
        .mockResolvedValue({
          status: 'available',
          sessions: [catalogEntry('b-only')],
        }),
    };
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.refresh' });
    expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
      status: 'loading',
      items: [
        expect.objectContaining({
          id: 'session-1',
          active: true,
        }),
      ],
    });
    expect(JSON.stringify(snapshots(messages).at(-1))).not.toContain(
      'a-existing',
    );
    workspace.cwd = 'C:\\workspace-b';
    staleRefresh.resolve({
      status: 'available',
      sessions: [catalogEntry('a-late')],
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions).toEqual({
        status: 'idle',
        items: [],
      });
    });
    expect(JSON.stringify(snapshots(messages).at(-1))).not.toContain(
      'a-late',
    );
    await Promise.resolve();

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'a-late',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(runtime.initialize).not.toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace-b',
      sessionId: 'a-late',
    });
  });

  it('disposes a candidate when its workspace changes during initialization', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('a-only')]
            : [catalogEntry('b-only')],
      })),
    };
    const first = createMockRuntime();
    const candidateInitialization = deferred<RuntimeAvailability>();
    const candidate = createMockRuntime();
    candidate.initialize.mockImplementation(
      () => candidateInitialization.promise,
    );
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(candidate);
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual([
        expect.objectContaining({ id: 'b-only' }),
      ]);
    });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(candidate.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'b-only',
      });
    });

    workspace.cwd = 'C:\\workspace-c';
    candidateInitialization.resolve(available('b-only'));
    await vi.waitFor(() => {
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'runtime.diagnostic',
            code: 'workspace-changed',
          }),
        ]),
      );
    });

    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: { status: 'unavailable' },
    });
    expect(
      snapshots(messages).some(
        (message) =>
          message.sessionId === 'b-only' &&
          message.connection.status === 'connected',
      ),
    ).toBe(false);
  });

  it('does not commit a candidate when its workspace changes during activation recovery flush', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('session-1')]
            : [catalogEntry('b-only')],
      })),
    };
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const first = createMockRuntime();
    const activationFlush = deferred<void>();
    let activationFlushPending = false;
    const candidate = createMockRuntime();
    candidate.initialize.mockImplementation(async () => {
      vi.spyOn(recovery, 'flush').mockImplementationOnce(
        () => {
          activationFlushPending = true;
          return activationFlush.promise;
        },
      );
      return available('b-only');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(candidate);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual([
        expect.objectContaining({ id: 'b-only' }),
      ]);
    });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(candidate.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'b-only',
      });
      expect(activationFlushPending).toBe(true);
      expect(recovery.getSelectedSessionId()).toBe('session-1');
    });

    const workspaceChangedAt = messages.length;
    workspace.cwd = 'C:\\workspace-c';
    activationFlush.resolve();

    await vi.waitFor(() => {
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: {
          status: 'unavailable',
          message:
            'The workspace changed before the Droid session could be opened.',
        },
      });
    });
    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(
      snapshots(messages.slice(workspaceChangedAt)).some(
        (message) =>
          message.sessionId === 'b-only' &&
          message.connection.status === 'connected',
      ),
    ).toBe(false);

    send(controller, 'b-only', 'turn-stale', 'Ignore');
    expect(candidate.sendTurn).not.toHaveBeenCalled();
  });

  it('rejects sends when the active runtime belongs to another workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const runtime = createMockRuntime();
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const { controller, messages } = createController(
      () => runtime,
      workspace,
      createCatalog([]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    const writesBeforeSend = writeSession.mock.calls.length;

    workspace.cwd = 'C:\\workspace-b';
    send(controller, 'session-1', 'turn-stale', 'Do not persist');

    expect(runtime.sendTurn).not.toHaveBeenCalled();
    expect(writeSession).toHaveBeenCalledTimes(writesBeforeSend);
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: {
        status: 'unavailable',
        message:
          'The workspace changed before the Droid session could be opened.',
      },
      turn: null,
      transcript: [],
      sessions: { status: 'idle', items: [] },
    });

    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.connection).toMatchObject({
        status: 'unavailable',
        message:
          'The workspace changed before the Droid session could be opened.',
      });
    });
    expect(runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('drops late stream events and disposes the stale runtime once after context loss', async () => {
    const release = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield { type: 'text-delta', text: 'late secret output' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');

    workspace.trusted = false;
    release.resolve();

    await vi.waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledOnce();
    });
    expect(JSON.stringify(messages)).not.toContain(
      'late secret output',
    );
    expect(turnStates(messages).at(-1)).toMatchObject({
      turnId: 'turn-1',
      status: 'submitting',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      connection: {
        status: 'unavailable',
        message:
          'Trust this workspace to start the local Droid runtime.',
      },
      turn: null,
    });

    controller.handleWorkspaceContextChanged();
    await controller.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('cancels permission and AskUser instead of accepting responses after context loss', async () => {
    let handler!: RuntimeInteractionHandler;
    let permission!: Promise<RuntimePermissionResult>;
    let askUser!: Promise<RuntimeAskUserResult>;
    const release = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime(async function* () {
      permission = handler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      askUser = handler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      await release.promise;
    });
    const { controller, messages } = createController((nextHandler) => {
      handler = nextHandler;
      return runtime;
    }, workspace);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    const permissionRequest = await waitForInteraction(
      messages,
      'permission',
    );
    const askUserRequest = await waitForInteraction(
      messages,
      'ask-user',
    );

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permissionRequest.request.requestId,
      selectedOption: 'proceed',
    });
    controller.handleMessage({
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: askUserRequest.request.requestId,
      cancelled: false,
      answers: [{ index: 0, answer: 'Yes' }],
    });

    await expect(permission).resolves.toEqual({
      selectedOption: 'cancel',
    });
    await expect(askUser).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    release.resolve();
    await controller.dispose();
  });

  it('closes the old runtime before initializing the latest usable workspace', async () => {
    const calls: string[] = [];
    const cleanup = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const first = createMockRuntime();
    first.dispose.mockImplementation(async () => {
      calls.push('dispose-a');
      await cleanup.promise;
    });
    const second = createMockRuntime();
    second.initialize.mockImplementation(async (target) => {
      calls.push(
        `initialize-${typeof target === 'string' ? target : target.cwd}`,
      );
      return available('session-b');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleWorkspaceContextChanged();
    workspace.cwd = 'C:\\workspace-c';
    controller.handleWorkspaceContextChanged();

    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    cleanup.resolve();
    await vi.waitFor(() => {
      expect(second.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace-c',
      });
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-b',
        connection: { status: 'connected' },
      });
    });
    expect(calls).toEqual([
      'dispose-a',
      'initialize-C:\\workspace-c',
    ]);
  });

  it('does not replace for untrusted or folderless contexts and ignores unchanged notifications', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const first = createMockRuntime();
    const replacement = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleWorkspaceContextChanged();
    expect(first.dispose).not.toHaveBeenCalled();

    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    workspace.cwd = null;
    workspace.trusted = true;
    controller.handleWorkspaceContextChanged();
    await Promise.resolve();
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(snapshots(messages).at(-1)?.connection).toMatchObject({
      status: 'unavailable',
      message: 'Open a workspace folder to use DroidVisX.',
    });

    workspace.cwd = 'C:\\workspace-b';
    controller.handleWorkspaceContextChanged();
    await vi.waitFor(() => {
      expect(replacement.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace-b',
      });
    });
  });

  it('deduplicates runtime cleanup across repeated notifications and disposal', async () => {
    const cleanup = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime();
    runtime.dispose.mockImplementation(() => cleanup.promise);
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    controller.handleWorkspaceContextChanged();
    const disposal = controller.dispose();
    expect(controller.dispose()).toBe(disposal);
    await vi.waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledOnce();
    });

    cleanup.resolve();
    await disposal;
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('resumes a shared session id when the active runtime belongs to another workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('shared-session')],
      })),
    };
    const first = createMockRuntime();
    first.initialize.mockResolvedValue(available('shared-session'));
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('shared-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'shared-session',
    });
    await vi.waitFor(() => {
      expect(catalog.listSessions).toHaveBeenCalledTimes(2);
      expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
        status: 'ready',
        items: [
          expect.objectContaining({ id: 'shared-session' }),
        ],
      });
    });

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'shared-session',
    });
    await vi.waitFor(() => {
      expect(second.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'shared-session',
      });
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'shared-session',
        connection: { status: 'connected' },
      });
    });

    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('blocks sends synchronously while session replacement is waiting to flush recovery', async () => {
    const first = createMockRuntime();
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    const replacementFlush = deferred<void>();
    vi.spyOn(recovery, 'flush').mockImplementationOnce(
      () => replacementFlush.promise,
    );

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: { status: 'connecting' },
    });

    send(controller, 'session-1', 'turn-during-replacement', 'Ignore');

    expect(first.sendTurn).not.toHaveBeenCalled();
    expect(first.dispose).not.toHaveBeenCalled();

    replacementFlush.resolve();
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-2',
        connection: { status: 'connected' },
      });
    });
    expect(first.sendTurn).not.toHaveBeenCalled();
  });

  it('closes before resume and keeps selection stable when resume fails', async () => {
    const calls: string[] = [];
    const first = createMockRuntime();
    first.dispose.mockImplementation(async () => {
      calls.push('close-old');
    });
    const second = createMockRuntime();
    second.initialize.mockImplementation(async () => {
      calls.push('initialize-new');
      throw new Error('sensitive resume failure');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const persistence = createMemoryPersistence();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        connection: {
          status: 'unavailable',
          message: 'The selected Droid session could not be opened.',
        },
      });
    });

    expect(calls).toEqual(['close-old', 'initialize-new']);
    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(snapshots(messages).at(-1)?.sessionId).toBe('session-1');
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive resume failure',
    );
  });

  it('coalesces streaming recovery checkpoints and persists terminal state', async () => {
    const runtime = createMockRuntime(async function* () {
      for (let index = 0; index < 100; index += 1) {
        yield { type: 'text-delta', text: 'x' };
      }
      yield successfulTurn();
    });
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(writeSession).toHaveBeenCalledOnce();

    send(controller, 'session-1', 'turn-1', 'Stream');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(writeSession).toHaveBeenCalledTimes(2);
    expect(writeSession).toHaveBeenLastCalledWith(
      'session-1',
      expect.objectContaining({
        transcript: [
          expect.objectContaining({
            kind: 'user',
            text: 'Stream',
          }),
          expect.objectContaining({
            kind: 'assistant',
            text: 'x'.repeat(100),
          }),
        ],
      }),
    );
  });

  it('refresh failure preserves chat and a new session is shown before catalog catch-up', async () => {
    const catalog = {
      listSessions: vi
        .fn<(cwd: string) => Promise<SessionCatalogResult>>()
        .mockResolvedValueOnce({
          status: 'available',
          sessions: [catalogEntry('session-1')],
        })
        .mockResolvedValueOnce({
          status: 'unavailable',
          reason: 'catalog-failed',
          message: 'raw failure',
        }),
    };
    const first = createMockRuntime();
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('lagging-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.refresh' });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.status).toBe('error');
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      connection: { status: 'connected' },
      sessionId: 'session-1',
    });

    controller.handleMessage({ type: 'session.new' });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe(
        'lagging-session',
      );
    });
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'lagging-session',
          active: true,
        }),
      ]),
    );
  });

  it('loads settings, context, and the fail-closed model catalog after activation and snapshots them on reload', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: {
            modelId: 'model-1',
            interactionMode: 'auto',
          },
        },
      });
      expect(
        lastMessage(messages, 'session.context'),
      ).toMatchObject({
        context: {
          status: 'ready',
          value: { used: 40, remaining: 60, limit: 100 },
        },
      });
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({
        modelCatalog: { status: 'unsupported', items: [] },
      });
    });

    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        settings: { status: 'ready' },
        context: { status: 'ready' },
        modelCatalog: { status: 'unsupported', items: [] },
      });
    });
  });

  it('updates stable settings from the authoritative reread and refuses model updates without a catalog', async () => {
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockResolvedValue({
      interactionMode: 'mission',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'unverified-model',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'spec',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledWith({
        field: 'interactionMode',
        value: 'spec',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { interactionMode: 'mission' },
        },
      });
    });
  });

  it('allows model and reasoning updates only from the projected Droid catalog', async () => {
    const runtime = createMockRuntime();
    runtime.readModelCatalog.mockResolvedValue({
      status: 'available',
      items: [
        {
          id: 'model-1',
          displayName: 'Model One',
          supportedReasoningEfforts: ['high'],
        },
        {
          id: 'model-2',
          displayName: 'Model Two',
          supportedReasoningEfforts: ['low', 'medium'],
        },
      ],
    });
    runtime.updateSessionSetting
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-2',
        reasoningEffort: 'medium',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-2',
        reasoningEffort: 'low',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({
        modelCatalog: {
          status: 'ready',
          items: [
            { id: 'model-1', displayName: 'Model One' },
            { id: 'model-2', displayName: 'Model Two' },
          ],
        },
      });
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'model-2',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(1, {
        field: 'modelId',
        value: 'model-2',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { modelId: 'model-2', reasoningEffort: 'medium' },
        },
      });
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'low',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(2, {
        field: 'reasoningEffort',
        value: 'low',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { modelId: 'model-2', reasoningEffort: 'low' },
        },
      });
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'max',
    });
    expect(runtime.updateSessionSetting).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });
  });

  it('applies spec drafting overrides from the catalog and accepts null resets', async () => {
    const runtime = createMockRuntime();
    runtime.readModelCatalog.mockResolvedValue({
      status: 'available',
      items: [
        {
          id: 'model-1',
          displayName: 'Model One',
          supportedReasoningEfforts: ['high'],
        },
        {
          id: 'model-2',
          displayName: 'Model Two',
          supportedReasoningEfforts: ['low', 'medium'],
        },
      ],
    });
    runtime.updateSessionSetting
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: 'model-2',
        specModeReasoningEffort: null,
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: 'model-2',
        specModeReasoningEffort: 'low',
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({ modelCatalog: { status: 'ready' } });
    });

    // Unknown drafting models are refused before the runtime.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 'unverified-model',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 'model-2',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(1, {
        field: 'specModeModelId',
        value: 'model-2',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeModelId: 'model-2' },
        },
      });
    });

    // Spec reasoning effort is validated against the drafting model,
    // not the session model.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeReasoningEffort',
      value: 'low',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(2, {
        field: 'specModeReasoningEffort',
        value: 'low',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeReasoningEffort: 'low' },
        },
      });
    });

    // A null reset needs no catalog knowledge.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: null,
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(3, {
        field: 'specModeModelId',
        value: null,
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeModelId: null },
        },
      });
    });
  });

  it('adopts the implementation session after an approved spec handoff turn completes', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const planning = createMockRuntime(async function* () {
      const result = await interactionHandler.requestPermission({
        options: [
          {
            label: 'Approve and start',
            value: 'proceed_new_session',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Ready to build',
            detail: '# Plan',
            editableSpecContent: '# Plan',
          },
        ],
      });
      expect(result.selectedOption).toBe('proceed_new_session');
      yield {
        type: 'spec-handoff' as const,
        implementationSessionId: 'session-impl',
      };
      yield successfulTurn();
    });
    const implementation = createMockRuntime();
    implementation.initialize.mockResolvedValue(
      available('session-impl'),
    );
    const createRuntime = vi.fn(
      (handler: RuntimeInteractionHandler) => {
        interactionHandler = handler;
        return createRuntime.mock.calls.length === 1
          ? planning
          : implementation;
      },
    );
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Draft a plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_new_session',
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe(
        'session-impl',
      );
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.diagnostic',
          severity: 'info',
          code: 'spec-handoff-detected',
        }),
      ]),
    );
    expect(planning.dispose).toHaveBeenCalledOnce();
    expect(implementation.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-impl',
    });
  });

  it('warns visibly when an approved spec handoff never identifies the implementation session', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const runtime = createMockRuntime(async function* () {
      await interactionHandler.requestPermission({
        options: [
          {
            label: 'Approve and start',
            value: 'proceed_new_session_high',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Ready to build',
            detail: '# Plan',
          },
        ],
      });
      yield successfulTurn();
    });
    const createRuntime = vi.fn(
      (handler: RuntimeInteractionHandler) => {
        interactionHandler = handler;
        return runtime;
      },
    );
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Draft a plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_new_session_high',
    });

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'runtime.diagnostic'),
      ).toMatchObject({ code: 'spec-handoff-not-detected' });
    });
    // No replacement happens without an identified session.
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('rejects wrong-session and duplicate setting updates and retains confirmed values on failure', async () => {
    const update = deferred<never>();
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockReturnValue(update.promise);
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'wrong-session',
      field: 'autonomyLevel',
      value: 'high',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'spec',
    });
    expect(runtime.updateSessionSetting).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-blocked',
    });

    update.reject(new Error('sensitive SDK failure'));
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'error',
          value: { autonomyLevel: 'medium' },
          message: 'Droid session settings could not be updated.',
        },
      });
    });
  });

  it('applies an authoritative setting update while a turn is active', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    runtime.updateSessionSetting.mockResolvedValue({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'high',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    send(controller, 'session-1', 'active-turn', 'Keep working');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledOnce();
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    });

    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledWith({
        field: 'autonomyLevel',
        value: 'high',
      });
      expect(lastMessage(messages, 'session.settings')).toMatchObject({
        settings: {
          status: 'ready',
          value: { autonomyLevel: 'high' },
        },
      });
    });
    release.resolve();
  });

  it('rereads authoritative settings when the SDK reports a settings change', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'settings-updated' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });
    runtime.readSessionSettings.mockResolvedValue({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });

    send(controller, 'session-1', 'settings-event', 'Implement the plan');

    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledTimes(2);
      expect(lastMessage(messages, 'session.settings')).toMatchObject({
        settings: {
          status: 'ready',
          value: { interactionMode: 'auto' },
        },
      });
    });
  });

  it('refreshes context on activation, explicit refresh, and terminal turn completion', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readContextStats).toHaveBeenCalledTimes(1);
    });

    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(runtime.readContextStats).toHaveBeenCalledTimes(2);
    });

    send(controller, 'session-1', 'turn-context', 'Continue');
    await vi.waitFor(() => {
      expect(runtime.readContextStats).toHaveBeenCalledTimes(3);
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
  });

  it('retains confirmed context across a failed refresh and retries once', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'ready',
          value: { used: 40, remaining: 60, limit: 100 },
        },
      });
    });
    runtime.readContextStats.mockRejectedValueOnce(
      new Error('sensitive SDK failure'),
    );

    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });
    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });

    await vi.waitFor(() => {
      expect(runtime.readContextStats).toHaveBeenCalledTimes(2);
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'error',
          value: { used: 40, remaining: 60, limit: 100 },
          message: expect.stringContaining('DroidVisX Logs'),
        },
      });
    });
    runtime.readContextStats.mockResolvedValueOnce({
      used: 145,
      remaining: 154,
      limit: 100,
      accuracy: 'estimated',
    });
    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });

    await vi.waitFor(() => {
      expect(runtime.readContextStats).toHaveBeenCalledTimes(3);
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'ready',
          value: {
            used: 145,
            remaining: 154,
            limit: 100,
            accuracy: 'estimated',
          },
        },
      });
    });
  });

  it('discards a stale setting update after a workspace generation change', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const update = deferred<{
      interactionMode: 'mission';
      modelId: 'stale-model';
      reasoningEffort: 'max';
      autonomyLevel: 'high';
      specModeModelId: null;
      specModeReasoningEffort: null;
    }>();
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockReturnValue(update.promise);
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'mission',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledOnce();
    });
    const changedAt = messages.length;
    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    update.resolve({
      interactionMode: 'mission',
      modelId: 'stale-model',
      reasoningEffort: 'max',
      autonomyLevel: 'high',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      messages.slice(changedAt).some(
        (message) =>
          message.type === 'session.settings' &&
          message.settings.status === 'ready' &&
          message.settings.value.modelId === 'stale-model',
      ),
    ).toBe(false);
    expect(snapshots(messages).at(-1)?.settings).toEqual({
      status: 'loading',
      value: null,
    });
  });

  it('flushes and disposes recovery state with the runtime exactly once', async () => {
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const flush = vi.spyOn(recovery, 'flush');
    const disposeRecovery = vi.spyOn(recovery, 'dispose');
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    const disposal = controller.dispose();
    expect(controller.dispose()).toBe(disposal);
    await disposal;

    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalled();
    expect(disposeRecovery).toHaveBeenCalledOnce();
  });
});

interface MockRuntime extends DroidRuntime {
  initialize: ReturnType<
    typeof vi.fn<
      (
        target: RuntimeSessionTarget | string,
      ) => Promise<RuntimeAvailability>
    >
  >;
  sendTurn: ReturnType<
    typeof vi.fn<(text: string) => AsyncIterable<RuntimeEvent>>
  >;
  readSessionSettings: ReturnType<
    typeof vi.fn<DroidRuntime['readSessionSettings']>
  >;
  readContextStats: ReturnType<
    typeof vi.fn<DroidRuntime['readContextStats']>
  >;
  readModelCatalog: ReturnType<
    typeof vi.fn<DroidRuntime['readModelCatalog']>
  >;
  updateSessionSetting: ReturnType<
    typeof vi.fn<DroidRuntime['updateSessionSetting']>
  >;
  interrupt: ReturnType<typeof vi.fn<() => Promise<void>>>;
  dispose: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createMockRuntime(
  stream: (text: string) => AsyncIterable<RuntimeEvent> = async function* () {
    yield successfulTurn();
  },
): MockRuntime {
  return {
    initialize: vi.fn(async () => available()),
    readSessionSettings: vi.fn(async () => ({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    })),
    readContextStats: vi.fn(async () => ({
      used: 40,
      remaining: 60,
      limit: 100,
      accuracy: 'exact',
    })),
    readModelCatalog: vi.fn(async () => ({
      status: 'unavailable',
    })),
    updateSessionSetting: vi.fn(async () => ({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    })),
    sendTurn: vi.fn(stream),
    interrupt: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

function createController(
  createRuntime: (handler: RuntimeInteractionHandler) => DroidRuntime,
  workspace:
    | { cwd: string | null; trusted: boolean }
    | undefined = undefined,
  catalog: SessionCatalog = createCatalog([]),
  recovery?: SessionRecoveryStore,
  history?: SessionHistoryLoader,
  attachments?: AttachmentSources,
  fileDiff?: FileDiffOpener,
  changeStats?: ChangeStatsReader,
  externalUrl?: ExternalUrlOpener,
  daemonSessions?: () => Promise<DaemonSessionCatalog>,
  pathOpener?: PathOpener,
  prototypePreview?: PrototypePreviewOpener,
  gitWorkflow?: GitWorkflow,
  worktreeSessions?: WorktreeSessionsFeature,
) {
  const controller = new ChatController(
    createRuntime,
    () =>
      workspace ?? {
        cwd: 'C:\\workspace',
        trusted: true,
      },
    catalog,
    recovery,
    history,
    attachments,
    fileDiff,
    changeStats,
    externalUrl,
    undefined,
    undefined,
    daemonSessions,
    pathOpener,
    prototypePreview,
    gitWorkflow,
    worktreeSessions,
  );
  const messages: HostToWebviewMessage[] = [];
  controller.subscribe((message) => {
    messages.push(message);
  });
  return { controller, messages };
}

function ready(controller: ChatController): void {
  controller.handleMessage({
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  });
}

function send(
  controller: ChatController,
  sessionId: string,
  turnId: string,
  text: string,
): void {
  controller.handleMessage({
    type: 'turn.send',
    sessionId,
    turnId,
    text,
  });
}

function stop(
  controller: ChatController,
  sessionId: string,
  turnId: string,
): void {
  controller.handleMessage({
    type: 'turn.stop',
    sessionId,
    turnId,
  });
}

function retry(
  controller: ChatController,
  sessionId: string | null,
): void {
  controller.handleMessage({
    type: 'runtime.retry',
    sessionId,
  });
}

function available(sessionId = 'session-1'): RuntimeAvailability {
  return {
    status: 'available',
    sdkVersion: '0.7.0',
    cliVersion: null,
    authenticationStatus: 'unknown',
    sessionId,
  };
}

function catalogEntry(id: string): SessionCatalogEntry {
  return {
    id,
    title: `Session ${id}`,
    messageCount: 1,
    modifiedTime: '2026-01-02T03:04:05.000Z',
    createdTime: '2026-01-01T03:04:05.000Z',
    isFavorite: false,
  };
}

function createCatalog(
  sessions: readonly SessionCatalogEntry[],
): SessionCatalog {
  return createCatalogResult({ status: 'available', sessions });
}

function createCatalogResult(
  result: SessionCatalogResult,
): SessionCatalog {
  return {
    listSessions: vi.fn(async () => result),
  };
}

function worktreeFeature(options: {
  readonly branch: string;
  readonly isGit?: boolean;
}): WorktreeSessionsFeature {
  return createWorktreeSessionsFeature({
    enabled: true,
    persistence: createMemoryPersistence(),
    exec: vi.fn(async (args: readonly string[]) =>
      args[1] === '--is-inside-work-tree'
        ? options.isGit === false
          ? 'false\n'
          : 'true\n'
        : `${options.branch}\n`,
    ) as GitExec,
  });
}

function createMemoryPersistence(): SessionRecoveryPersistence {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
}

function successfulTurn(): Extract<
  RuntimeEvent,
  { type: 'turn-complete' }
> {
  return {
    type: 'turn-complete',
    outcome: 'success',
  };
}

function connectionMessages(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'host.connection' | 'host.snapshot' }
    > =>
      message.type === 'host.connection' ||
      message.type === 'host.snapshot',
  );
}

function snapshots(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'host.snapshot' }
    > => message.type === 'host.snapshot',
  );
}

function lastMessage<
  Type extends HostToWebviewMessage['type'],
>(
  messages: readonly HostToWebviewMessage[],
  type: Type,
): Extract<HostToWebviewMessage, { type: Type }> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === type) {
      return message as Extract<
        HostToWebviewMessage,
        { type: Type }
      >;
    }
  }
  return undefined;
}

function turnStates(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'turn.state' }
    > => message.type === 'turn.state',
  );
}

function toolActivities(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'tool.activity' }
    > => message.type === 'tool.activity',
  );
}

function interactionRequests(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'interaction.request' }
    > => message.type === 'interaction.request',
  );
}

async function waitForInteraction(
  messages: readonly HostToWebviewMessage[],
  kind: Extract<
    HostToWebviewMessage,
    { type: 'interaction.request' }
  >['request']['kind'],
): Promise<
  Extract<HostToWebviewMessage, { type: 'interaction.request' }>
> {
  let request:
    | Extract<
        HostToWebviewMessage,
        { type: 'interaction.request' }
      >
    | undefined;
  await vi.waitFor(() => {
    request = interactionRequests(messages).find(
      (message) => message.request.kind === kind,
    );
    expect(request).toBeDefined();
  });
  return request!;
}

function attachmentsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.attachments' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.attachments' }
    > => message.type === 'session.attachments',
  );
}

function skillsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.skills' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.skills' }
    > => message.type === 'session.skills',
  );
}

function commandsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.commands' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.commands' }
    > => message.type === 'session.commands',
  );
}

function mcpMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.mcp' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.mcp' }
    > => message.type === 'session.mcp',
  );
}

function mcpAuthMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'mcp.auth' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'mcp.auth' }
    > => message.type === 'mcp.auth',
  );
}

async function waitForConnected(
  messages: readonly HostToWebviewMessage[],
): Promise<void> {
  await vi.waitFor(() => {
    expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
      'connected',
    );
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
