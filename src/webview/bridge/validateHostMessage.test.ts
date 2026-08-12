import { describe, expect, it } from 'vitest';

import {
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_SEARCH_SNIPPET_LENGTH,
  MAX_OPEN_PATH_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_WORKTREE_BRANCH_LENGTH,
  MAX_WORKTREE_PATH_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_SPEC_PLAN_LENGTH,
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_TOOL_OUTPUT_TAIL_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  type HostToWebviewMessage,
} from '../../shared/bridgeMessages';
import { readHostMessage } from './validateHostMessage';

describe('readHostMessage', () => {
  it.each<HostToWebviewMessage>([
    {
      type: 'host.snapshot',
      sequence: 0,
      sessionId: null,
      connection: { status: 'idle' },
      turn: null,
      sessions: { status: 'idle', items: [] },
      settings: { status: 'loading', value: null },
      context: { status: 'loading', value: null },
      modelCatalog: { status: 'loading', items: [] },
      transcript: [],
      historyStatus: 'unavailable',
      truncated: false,
    },
    {
      type: 'host.snapshot',
      sequence: 1,
      sessionId: null,
      connection: { status: 'unavailable' },
      turn: null,
      sessions: {
        status: 'error',
        items: [],
        message: 'Session history is temporarily unavailable.',
      },
      settings: {
        status: 'error',
        value: null,
        message: 'Settings unavailable.',
      },
      context: {
        status: 'error',
        value: null,
        message: 'Context unavailable.',
      },
      modelCatalog: {
        status: 'unsupported',
        items: [],
        message: 'Model discovery is unavailable.',
      },
      transcript: [],
      historyStatus: 'unavailable',
      truncated: false,
    },
    {
      type: 'host.snapshot',
      sequence: 2,
      sessionId: 'session-1',
      connection: { status: 'connected' },
      turn: null,
      sessions: {
        status: 'ready',
        items: [
          {
            id: 'session-1',
            title: 'Protocol work',
            messageCount: 5,
            modifiedTime: '2026-08-09T09:00:00.000Z',
            active: true,
            isFavorite: true,
          },
        ],
      },
      settings: readySettings(),
      context: readyContext(),
      modelCatalog: readyModelCatalog(),
      transcript: [
        { id: 'user-1', kind: 'user', text: 'Implement sessions.' },
        {
          id: 'user-2',
          kind: 'user',
          text: 'With a rewind anchor.',
          messageId: 'sdk-message-1',
        },
        {
          id: 'user-3',
          kind: 'user',
          text: 'With sent attachments.',
          messageId: 'sdk-message-2',
          attachments: [
            { kind: 'text', name: 'notes.md', sizeBytes: 120 },
            { kind: 'pdf', name: 'spec.pdf', sizeBytes: 2048 },
          ],
        },
        {
          id: 'assistant-1',
          kind: 'assistant',
          turnId: 'turn-1',
          text: 'I will inspect the protocol.',
        },
        {
          id: 'thinking-1',
          kind: 'thinking',
          turnId: 'turn-1',
          text: 'Checking the bridge.',
          status: 'complete',
          durationMs: 12,
          truncated: false,
        },
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-use-1',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'completed',
          progressCount: 2,
          latestUpdateKind: 'status',
        },
        {
          id: 'changes-1',
          kind: 'changes',
          turnId: 'turn-1',
          files: [
            { path: 'src/app.ts', additions: 3, deletions: 1 },
            { path: 'docs/new.md', additions: null, deletions: null },
          ],
        },
        {
          id: 'diagnostic-1',
          kind: 'diagnostic',
          turnId: null,
          severity: 'warning',
          code: 'history-partial',
          message: 'Some unsupported events were omitted.',
        },
      ],
      historyStatus: 'partial',
      truncated: true,
    },
    {
      type: 'host.connection',
      sequence: 1,
      sessionId: 'session-1',
      connection: { status: 'connected' },
    },
    {
      type: 'session.settings',
      sequence: 1,
      sessionId: 'session-1',
      settings: readySettings(),
    },
    {
      type: 'session.context',
      sequence: 1,
      sessionId: 'session-1',
      context: readyContext(),
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: readyModelCatalog(),
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
          {
            name: 'docs-writer',
            description: null,
            location: 'builtin',
            enabled: false,
            userInvocable: false,
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: { status: 'loading', items: [] },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'unsupported',
        items: [],
        message: 'Skills are unsupported.',
      },
    },
    {
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [
          {
            id: 'core@factory-plugins',
            scope: 'user',
            version: 'e3ff29f752fb',
            active: true,
          },
          {
            id: 'linter@acme',
            scope: 'project',
            version: '',
            active: false,
          },
        ],
        marketplaceCount: 0,
      },
    },
    {
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: { status: 'loading', items: [] },
    },
    {
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'error',
        items: [],
        message: 'The local droid daemon is unavailable.',
      },
    },
    {
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'unsupported',
        items: [],
        message: 'Plugins are unsupported.',
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'ready',
        items: [
          {
            name: 'deploy',
            description: 'Deploys the current branch.',
            argumentHint: '<environment>',
            isExecutable: false,
          },
          {
            name: 'triage',
            description: null,
            argumentHint: null,
            isExecutable: true,
          },
        ],
        recent: ['deploy'],
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: { status: 'loading', items: [], recent: [] },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'error',
        items: [],
        recent: [],
        message: 'Commands could not be loaded.',
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'unsupported',
        items: [],
        recent: [],
        message: 'Commands are unsupported.',
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'ready',
        items: [
          {
            name: 'linear',
            status: 'connected',
            toolCount: 2,
            requiresAuth: false,
            hasAuthTokens: false,
            tools: [
              {
                name: 'list-issues',
                description: 'Lists issues.',
                enabled: true,
                readOnly: true,
              },
              {
                name: 'create-issue',
                description: null,
                enabled: false,
                readOnly: false,
              },
            ],
          },
          {
            name: 'sentry',
            status: 'disabled',
            toolCount: null,
            requiresAuth: true,
            hasAuthTokens: true,
            tools: [],
          },
        ],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: { status: 'loading', items: [] },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'error',
        items: [],
        message: 'MCP listing failed.',
      },
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'started',
      message: null,
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'browser',
      message: 'Complete the sign-in in your browser.',
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'success',
      message: null,
    },
    {
      type: 'session.attachments',
      sequence: 1,
      sessionId: 'session-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'image',
          name: 'shot.png',
          sizeBytes: 1024,
          truncated: false,
        },
        {
          id: 'attachment-2',
          kind: 'selection',
          name: 'main.ts:1-10',
          sizeBytes: 200,
          truncated: true,
        },
      ],
    },
    {
      type: 'session.attachments',
      sequence: 1,
      sessionId: 'session-1',
      attachments: [],
    },
    {
      type: 'session.editAttachments',
      sequence: 1,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'text',
          name: 'notes.md',
          sizeBytes: 200,
          truncated: false,
          restorable: true,
        },
        {
          id: 'attachment-2',
          kind: 'pdf',
          name: 'spec.pdf',
          sizeBytes: 4096,
          truncated: false,
          restorable: false,
        },
      ],
    },
    {
      type: 'turn.editResendRejected',
      sequence: 2,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      reason: 'busy',
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: { status: 'loading', items: [] },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'ready',
        items: [
          {
            id: 'session-9',
            title: 'Archived investigation',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: '2026-08-02T11:30:00.000Z',
          },
        ],
      },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'error',
        items: [],
        message: 'daemon unavailable',
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'ready',
        query: 'refactor',
        items: [
          {
            id: 'session-3',
            title: 'Refactor store',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            snippet: 'plan the refactor of the reducer',
          },
          {
            id: 'session-4',
            title: 'Untitled',
            modifiedTime: null,
            snippet: null,
          },
        ],
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'error',
        query: 'refactor',
        items: [],
        message: 'daemon unavailable',
      },
    },
    {
      type: 'assistant.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Hello',
    },
    {
      type: 'thinking.delta',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: false,
      segmentIndex: 0,
    },
    {
      type: 'thinking.complete',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: null,
      segmentIndex: 1,
    },
    {
      type: 'tool.activity',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
    },
    {
      type: 'tool.activity',
      sequence: 6,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
    },
    {
      type: 'tool.activity',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'failed',
      progressCount: 1,
      latestUpdateKind: 'error',
    },
    {
      type: 'tool.activity',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
      durationMs: 3500,
    },
    {
      type: 'tool.activity',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      filePath: 'src/webview/assistant/App.tsx',
    },
    {
      type: 'turn.changes',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        { path: 'src/app.ts', additions: 3, deletions: 1 },
        { path: 'docs/new.md', additions: null, deletions: null },
      ],
    },
    {
      type: 'git.status',
      sequence: 7,
      sessionId: 'session-1',
      branch: 'feature/commit-panel',
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          inTurn: true,
        },
        {
          path: 'notes.md',
          status: 'untracked',
          staged: true,
          inTurn: false,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 7,
      sessionId: 'session-1',
      branch: null,
      files: [],
    },
    {
      type: 'git.status',
      sequence: 7,
      sessionId: 'session-1',
      branch: null,
      files: [],
      unavailableReason: 'no-git-extension',
    },
    {
      type: 'git.commitResult',
      sequence: 7,
      sessionId: 'session-1',
      ok: true,
      hash: 'abc1234',
      subject: 'feat: add commit panel',
    },
    {
      type: 'git.commitResult',
      sequence: 7,
      sessionId: 'session-1',
      ok: true,
      hash: '',
      subject: '',
    },
    {
      type: 'git.commitResult',
      sequence: 7,
      sessionId: 'session-1',
      ok: false,
      error: 'pre-commit hook exited with code 1',
    },
    {
      type: 'transcript.image',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      item: {
        id: 'image-1',
        kind: 'image',
        turnId: 'turn-1',
        origin: 'tool-result',
        mediaType: 'image/png',
        data: 'aGVsbG8=',
        generated: false,
        byteLength: 5,
      },
    },
    {
      type: 'transcript.image',
      sequence: 8,
      sessionId: 'session-1',
      turnId: 'turn-1',
      item: {
        id: 'image-2',
        kind: 'image',
        turnId: 'turn-1',
        origin: 'assistant',
        mediaType: 'image/webp',
        data: '',
        generated: true,
        byteLength: 4_000_000,
      },
    },
    {
      type: 'workspace.files',
      sequence: 8,
      sessionId: 'session-1',
      requestId: 'file-search-1',
      status: 'ok',
      files: ['src/app.ts', 'docs/readme.md'],
    },
    {
      type: 'workspace.files',
      sequence: 9,
      sessionId: 'session-1',
      requestId: 'file-search-2',
      status: 'no-workspace',
      files: [],
    },
    {
      type: 'workspace.imageData',
      sequence: 9,
      sessionId: 'session-1',
      path: 'out/plot.png',
      status: 'ok',
      mediaType: 'image/png',
      data: 'aGk=',
    },
    {
      type: 'workspace.imageData',
      sequence: 9,
      sessionId: 'session-1',
      path: 'missing.png',
      status: 'not-found',
      mediaType: null,
      data: '',
    },
    {
      type: 'rewind.info',
      sequence: 10,
      sessionId: 'session-1',
      messageId: 'message-1',
      restorableCount: 3,
      createdCount: 0,
    },
    {
      type: 'runtime.diagnostic',
      sequence: 8,
      sessionId: 'session-1',
      turnId: 'turn-1',
      severity: 'warning',
      code: 'diagnostic-code',
      message: 'Safe diagnostic',
    },
    {
      type: 'runtime.diagnostic',
      sequence: 9,
      sessionId: 'session-2',
      turnId: null,
      severity: 'info',
      code: 'session-compacted',
      message: 'Conversation compacted.',
      relatedSessionId: 'session-1',
    },
    {
      type: 'turn.state',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'streaming',
    },
    {
      type: 'user.message-meta',
      sequence: 21,
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'sdk-message-1',
    },
    {
      type: 'turn.error',
      sequence: 10,
      sessionId: 'session-1',
      turnId: 'turn-1',
      code: 'turn-failed',
      message: 'Safe failure',
      retryable: true,
    },
    {
      type: 'interaction.request',
      sequence: 11,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'permission',
        tools: [
          {
            toolUseId: 'tool-1',
            toolName: 'Execute',
            confirmationKind: 'exit_spec_mode',
            title: 'Run the focused tests',
            detail: 'pnpm vitest run',
            riskNote: 'Modifies generated test caches.',
          },
        ],
        options: [
          {
            label: 'Allow once',
            value: 'proceed_once',
            requiresEditedSpec: false,
          },
        ],
        editableSpecContent: '',
      },
    },
    {
      type: 'interaction.request',
      sequence: 12,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-2',
        kind: 'ask-user',
        toolCallId: 'tool-call-1',
        questions: [
          {
            index: 0,
            topic: '',
            question: 'Which environment?',
            options: ['Staging', 'Production'],
            multiSelect: false,
          },
        ],
      },
    },
    {
      type: 'interaction.closed',
      sequence: 13,
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-2',
    },
  ])('accepts a valid $type host message', (message) => {
    expect(readHostMessage(message)).toEqual(message);
  });

  it('rejects inconsistent tool progress metadata', () => {
    expect(
      readHostMessage({
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: 'tool-result',
      }),
    ).toBeUndefined();
  });

  it('accepts preserved loading, updating, error, and unsupported metadata', () => {
    expect(
      readHostMessage({
        type: 'session.settings',
        sequence: 1,
        sessionId: 'session-1',
        settings: {
          status: 'updating',
          value: readySettings().value,
        },
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'session.context',
        sequence: 2,
        sessionId: 'session-1',
        context: {
          status: 'error',
          value: readyContext().value,
          message: 'Refresh failed.',
        },
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'session.context',
        sequence: 2,
        sessionId: 'session-1',
        context: {
          status: 'ready',
          value: {
            used: 130,
            remaining: 169,
            limit: 100,
            accuracy: 'estimated',
          },
        },
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'session.context',
        sequence: 2,
        sessionId: 'session-1',
        context: {
          status: 'ready',
          value: {
            used: 0,
            remaining: 0,
            limit: 0,
            accuracy: 'estimated',
          },
        },
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'session.model-catalog',
        sequence: 3,
        sessionId: 'session-1',
        modelCatalog: {
          status: 'unsupported',
          items: [],
          message: 'Discovery is unsupported.',
        },
      }),
    ).toBeDefined();
  });

  it.each([
    {
      type: 'session.settings',
      sequence: 1,
      sessionId: 'session-1',
      settings: {
        status: 'ready',
        value: { ...readySettings().value, interactionMode: 'agi' },
      },
    },
    {
      type: 'session.context',
      sequence: 1,
      sessionId: 'session-1',
      context: {
        status: 'ready',
        value: {
          used: -1,
          remaining: 1,
          limit: 1,
          accuracy: 'estimated',
        },
      },
    },
    {
      type: 'session.context',
      sequence: 1,
      sessionId: 'session-1',
      context: {
        status: 'ready',
        value: {
          used: 0.25,
          remaining: 0.75,
          limit: 1,
          accuracy: 'estimated',
        },
      },
    },
    {
      type: 'session.context',
      sequence: 1,
      sessionId: 'session-1',
      context: {
        status: 'ready',
        value: {
          used: Number.POSITIVE_INFINITY,
          remaining: 0,
          limit: Number.POSITIVE_INFINITY,
          accuracy: 'estimated',
        },
      },
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: {
        status: 'ready',
        items: [
          ...readyModelCatalog().items,
          ...readyModelCatalog().items,
        ],
      },
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: {
        status: 'ready',
        items: [
          {
            ...readyModelCatalog().items[0],
            supportedReasoningEfforts: ['high', 'high'],
          },
        ],
      },
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: {
        status: 'ready',
        items: [
          {
            id: ' model-a',
            displayName: 'Model A',
            supportedReasoningEfforts: ['high'],
          },
        ],
      },
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: {
        status: 'ready',
        items: [
          {
            id: 'model-a',
            displayName: 'Model\u0000A',
            supportedReasoningEfforts: ['high'],
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'ready',
        items: [
          {
            name: '',
            description: null,
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'code-review',
            description: null,
            location: 'somewhere-else',
            enabled: true,
            userInvocable: true,
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'dup',
            description: null,
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
          {
            name: 'dup',
            description: null,
            location: 'personal',
            enabled: false,
            userInvocable: false,
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'code-review',
            description: null,
            location: 'project',
            enabled: true,
            userInvocable: true,
            filePath: 'C:/secret/path/SKILL.md',
          },
        ],
      },
    },
    {
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-1',
      skills: { status: 'unsupported', items: [] },
    },
    {
      // Ready without the marketplace count is malformed.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [],
      },
    },
    {
      // Scope outside the user/project whitelist.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [
          {
            id: 'core@factory-plugins',
            scope: 'enterprise',
            version: 'e3ff29f752fb',
            active: true,
          },
        ],
        marketplaceCount: 0,
      },
    },
    {
      // Install paths must never cross the bridge.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [
          {
            id: 'core@factory-plugins',
            scope: 'user',
            version: 'e3ff29f752fb',
            active: true,
            installPath: 'C:/secret/path',
          },
        ],
        marketplaceCount: 0,
      },
    },
    {
      // Duplicate plugin ids.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [
          { id: 'dup@m', scope: 'user', version: 'a', active: true },
          { id: 'dup@m', scope: 'project', version: 'b', active: false },
        ],
        marketplaceCount: 0,
      },
    },
    {
      // Empty id.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'ready',
        items: [{ id: '', scope: 'user', version: 'a', active: true }],
        marketplaceCount: 0,
      },
    },
    {
      // Negative marketplace count.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: { status: 'ready', items: [], marketplaceCount: -1 },
    },
    {
      // Marketplace count beyond the shared bound.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: { status: 'ready', items: [], marketplaceCount: 1001 },
    },
    {
      // Loading must not carry a marketplace count.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: { status: 'loading', items: [], marketplaceCount: 0 },
    },
    {
      // Error without a message.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: { status: 'error', items: [] },
    },
    {
      // Unsupported must not carry items.
      type: 'session.plugins',
      sequence: 1,
      sessionId: 'session-1',
      plugins: {
        status: 'unsupported',
        items: [{ id: 'x@m', scope: 'user', version: 'a', active: true }],
        message: 'Plugins are unsupported.',
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'ready',
        items: [
          {
            name: 'bad name',
            description: null,
            argumentHint: null,
            isExecutable: false,
          },
        ],
        recent: [],
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'ready',
        items: [
          {
            name: 'dup',
            description: null,
            argumentHint: null,
            isExecutable: false,
          },
          {
            name: 'dup',
            description: 'Duplicate name.',
            argumentHint: null,
            isExecutable: false,
          },
        ],
        recent: [],
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'ready',
        items: [
          {
            name: 'deploy',
            description: null,
            argumentHint: null,
            isExecutable: false,
            filePath: 'C:/secret/deploy.md',
          },
        ],
        recent: [],
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'ready',
        items: [],
        recent: ['bad name'],
      },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: { status: 'ready', items: [] },
    },
    {
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-1',
      commands: {
        status: 'unsupported',
        items: [],
        recent: [],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'ready',
        items: [
          {
            name: '',
            status: 'connected',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
        ],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'ready',
        items: [
          {
            name: 'linear',
            status: 'exploded',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
        ],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'ready',
        items: [
          {
            name: 'linear',
            status: 'connected',
            toolCount: 1,
            requiresAuth: false,
            tools: [
              {
                name: 'list-issues',
                description: null,
                enabled: true,
                readOnly: true,
                command: 'rm -rf /',
              },
            ],
          },
        ],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: {
        status: 'ready',
        items: [
          {
            name: 'dup',
            status: 'connected',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
          {
            name: 'dup',
            status: 'disabled',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
        ],
      },
    },
    {
      type: 'session.mcp',
      sequence: 1,
      sessionId: 'session-1',
      mcp: { status: 'error', items: [] },
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: '',
      phase: 'started',
      message: null,
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'authenticating',
      message: null,
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'browser',
      message: 'm'.repeat(257),
    },
    {
      type: 'mcp.auth',
      sequence: 1,
      sessionId: 'session-1',
      serverName: 'sentry',
      phase: 'browser',
      message: null,
      authUrl: 'https://example.com',
    },
    {
      type: 'session.attachments',
      sequence: 1,
      sessionId: 'session-1',
      attachments: [
        {
          id: '',
          kind: 'image',
          name: 'shot.png',
          sizeBytes: 1,
          truncated: false,
        },
      ],
    },
    {
      // Edit staging entries must carry a boolean restorable flag.
      type: 'session.editAttachments',
      sequence: 1,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'text',
          name: 'notes.md',
          sizeBytes: 200,
          truncated: false,
        },
      ],
    },
    {
      type: 'session.editAttachments',
      sequence: 1,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'text',
          name: 'notes.md',
          sizeBytes: 200,
          truncated: false,
          restorable: 'yes',
        },
      ],
    },
    {
      // Reject reasons come from the shared whitelist.
      type: 'turn.editResendRejected',
      sequence: 2,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      reason: 'because',
    },
    {
      type: 'turn.editResendRejected',
      sequence: 2,
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
      reason: 'busy',
      extra: true,
    },
    {
      type: 'session.attachments',
      sequence: 1,
      sessionId: 'session-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'archive',
          name: 'shot.zip',
          sizeBytes: 1,
          truncated: false,
        },
      ],
    },
    {
      type: 'session.attachments',
      sequence: 1,
      sessionId: 'session-1',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'image',
          name: 'shot.png',
          sizeBytes: 1,
          truncated: false,
          data: 'base64-content-must-not-cross',
        },
      ],
    },
    {
      type: 'session.model-catalog',
      sequence: 1,
      sessionId: 'session-1',
      modelCatalog: {
        status: 'ready',
        items: [
          {
            id: 'model-a',
            displayName: 'Model A',
            supportedReasoningEfforts: [],
          },
        ],
      },
    },
    { type: 'session.archived', sequence: 4 },
    {
      type: 'session.archived',
      sequence: 4,
      archived: { status: 'pending', items: [] },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: { status: 'loading', items: [], message: 'extra' },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: { status: 'error', items: [] },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'ready',
        items: [
          {
            id: '',
            title: 'Bad id',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: '2026-08-02T11:30:00.000Z',
          },
        ],
      },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'ready',
        items: [
          {
            id: 'session-9',
            title: 'ctrl\u0007title',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: '2026-08-02T11:30:00.000Z',
          },
        ],
      },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'ready',
        items: [
          {
            id: 'session-9',
            title: 'No archive time',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: 'yesterday',
          },
        ],
      },
    },
    {
      type: 'session.archived',
      sequence: 4,
      archived: {
        status: 'ready',
        items: [
          {
            id: 'session-9',
            title: 'Duplicate',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: '2026-08-02T11:30:00.000Z',
          },
          {
            id: 'session-9',
            title: 'Duplicate',
            modifiedTime: '2026-08-01T10:00:00.000Z',
            archivedTime: '2026-08-02T11:30:00.000Z',
          },
        ],
      },
    },
    { type: 'session.searchResults', sequence: 5 },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: { status: 'ready', query: '', items: [] },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'ready',
        query: 'q'.repeat(MAX_SESSION_SEARCH_QUERY_LENGTH + 1),
        items: [],
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'error',
        query: 'refactor',
        items: [
          {
            id: 'session-3',
            title: 'Should be empty on error',
            modifiedTime: null,
            snippet: null,
          },
        ],
        message: 'daemon unavailable',
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'ready',
        query: 'refactor',
        items: [
          {
            id: 'session-3',
            title: 'Snippet too long',
            modifiedTime: null,
            snippet: 's'.repeat(MAX_SESSION_SEARCH_SNIPPET_LENGTH + 1),
          },
        ],
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'ready',
        query: 'refactor',
        items: [
          {
            id: 'session-3',
            title: 'Snippet with newline',
            modifiedTime: null,
            snippet: 'line\nbreak',
          },
        ],
      },
    },
    {
      type: 'session.searchResults',
      sequence: 5,
      search: {
        status: 'ready',
        query: 'refactor',
        items: [
          {
            id: 'session-3',
            title: 'Extra key',
            modifiedTime: null,
            snippet: null,
            token: 'must-not-cross',
          },
        ],
      },
    },
  ])('rejects malformed protocol-v2 metadata %#', (message) => {
    expect(readHostMessage(message)).toBeUndefined();
  });

  it('rejects hostile metadata nesting without invoking accessors', () => {
    let calls = 0;
    const settings = {
      status: 'ready',
      get value() {
        calls += 1;
        return readySettings().value;
      },
    };
    const catalog = {
      status: 'ready',
      items: [
        {
          id: 'model-a',
          displayName: 'Model A',
          supportedReasoningEfforts: ['high'],
          [Symbol('extra')]: true,
        },
      ],
    };

    expect(
      readHostMessage({
        type: 'session.settings',
        sequence: 1,
        sessionId: 'session-1',
        settings,
      }),
    ).toBeUndefined();
    expect(calls).toBe(0);
    expect(
      readHostMessage({
        type: 'session.model-catalog',
        sequence: 2,
        sessionId: 'session-1',
        modelCatalog: catalog,
      }),
    ).toBeUndefined();
  });

  it.each([
    null,
    [],
    {},
    { type: 'unknown', sequence: 0 },
    {
      type: 'runtime.unsupported',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      eventType: 'tool-start',
    },
    {
      type: 'host.snapshot',
      sequence: 0,
      sessionId: null,
      turn: null,
    },
    {
      type: 'host.connection',
      sequence: Number.NaN,
      sessionId: null,
      connection: { status: 'connected' },
    },
    {
      type: 'assistant.delta',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 42,
    },
    {
      type: 'assistant.delta',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: '',
    },
    {
      type: 'assistant.delta',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'x'.repeat(MAX_ASSISTANT_TEXT_LENGTH + 1),
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'x'.repeat(MAX_THINKING_TEXT_LENGTH + 1),
      truncated: false,
      segmentIndex: 0,
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: 'no',
      segmentIndex: 0,
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: false,
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: false,
      segmentIndex: -1,
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: false,
      segmentIndex: 1.5,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: -1,
      segmentIndex: 0,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 1.5,
      segmentIndex: 0,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: Number.MAX_SAFE_INTEGER + 1,
      segmentIndex: 0,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 10,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 10,
      segmentIndex: '0',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: '',
      toolName: 'Read',
      status: 'running',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      durationMs: -1,
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      durationMs: 1.5,
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'x'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      toolName: 'Read',
      status: 'running',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: '',
      status: 'running',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'x'.repeat(MAX_TOOL_NAME_LENGTH + 1),
      status: 'running',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      status: 'waiting',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      filePath: '../outside.ts',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      filePath: 'src\\app.ts',
    },
    {
      type: 'tool.activity',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      filePath: '',
    },
    {
      type: 'turn.changes',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [],
    },
    {
      type: 'workspace.files',
      sequence: 5,
      sessionId: 'session-1',
      requestId: '',
      files: ['src/app.ts'],
    },
    {
      type: 'rewind.info',
      sequence: 5,
      sessionId: 'session-1',
      messageId: 'message-1',
      restorableCount: -1,
      createdCount: 0,
    },
    {
      type: 'rewind.info',
      sequence: 5,
      sessionId: 'session-1',
      messageId: '',
      restorableCount: 1,
      createdCount: 0,
    },
    {
      type: 'rewind.info',
      sequence: 5,
      sessionId: 'session-1',
      messageId: 'message-1',
      restorableCount: 1,
      createdCount: 0,
      extra: true,
    },
    {
      type: 'workspace.files',
      sequence: 5,
      sessionId: 'session-1',
      requestId: 'r-1',
      files: ['../outside.ts'],
    },
    {
      type: 'workspace.files',
      sequence: 5,
      sessionId: 'session-1',
      requestId: 'r-1',
      files: ['src/app.ts', 'src/app.ts'],
    },
    {
      type: 'workspace.files',
      sequence: 5,
      sessionId: 'session-1',
      requestId: 'r-1',
      files: Array.from({ length: 21 }, (_, i) => `f${i}.ts`),
    },
    {
      type: 'workspace.files',
      sequence: 5,
      sessionId: 'session-1',
      requestId: 'r-1',
      files: ['src/app.ts'],
      extra: true,
    },
    // Bytes without an ok status (and vice versa) are incoherent.
    {
      type: 'workspace.imageData',
      sequence: 5,
      sessionId: 'session-1',
      path: 'out/plot.png',
      status: 'ok',
      mediaType: 'image/png',
      data: '',
    },
    {
      type: 'workspace.imageData',
      sequence: 5,
      sessionId: 'session-1',
      path: 'out/plot.png',
      status: 'ok',
      mediaType: null,
      data: 'aGk=',
    },
    {
      type: 'workspace.imageData',
      sequence: 5,
      sessionId: 'session-1',
      path: 'out/plot.png',
      status: 'too-large',
      mediaType: null,
      data: 'aGk=',
    },
    {
      type: 'workspace.imageData',
      sequence: 5,
      sessionId: 'session-1',
      path: 'out/plot.png',
      status: 'ok',
      mediaType: 'image/svg+xml',
      data: 'aGk=',
    },
    {
      type: 'workspace.imageData',
      sequence: 5,
      sessionId: 'session-1',
      path: '',
      status: 'not-found',
      mediaType: null,
      data: '',
    },
    {
      type: 'turn.changes',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [{ path: '../outside.ts', additions: 1, deletions: 0 }],
    },
    {
      type: 'turn.changes',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        { path: 'src/app.ts', additions: 1, deletions: 0 },
        { path: 'src/app.ts', additions: 2, deletions: 0 },
      ],
    },
    {
      type: 'turn.changes',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        { path: 'src/app.ts', additions: -1, deletions: 0 },
      ],
    },
    {
      type: 'turn.changes',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        {
          path: 'src/app.ts',
          additions: 1,
          deletions: 0,
          patch: 'raw diff must not cross',
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: '',
      files: [],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'x'.repeat(251),
      files: [],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [
        {
          path: '../outside.ts',
          status: 'modified',
          staged: false,
          inTurn: false,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [
        {
          path: 'src/app.ts',
          status: 'evil',
          staged: false,
          inTurn: false,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: 'yes',
          inTurn: false,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          inTurn: false,
        },
        {
          path: 'src/app.ts',
          status: 'added',
          staged: true,
          inTurn: true,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          inTurn: false,
          extra: true,
        },
      ],
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: Array.from({ length: 101 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        status: 'modified',
        staged: false,
        inTurn: false,
      })),
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: null,
      files: [],
      unavailableReason: 'nonsense',
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: 'main',
      files: [],
      unavailableReason: 'no-repository',
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: null,
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          staged: false,
          inTurn: false,
        },
      ],
      unavailableReason: 'no-repository',
    },
    {
      type: 'git.status',
      sequence: 5,
      sessionId: 'session-1',
      branch: null,
      files: [],
      extra: 1,
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: true,
      hash: 'XYZ1234',
      subject: 'bad hash',
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: true,
      hash: 'abc1234',
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: true,
      hash: 'abc1234',
      subject: 'x'.repeat(201),
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: true,
      hash: 'abc1234',
      subject: 'ok',
      error: 'must not carry both',
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: false,
      error: '',
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: false,
      error: 'x'.repeat(2001),
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: false,
    },
    {
      type: 'git.commitResult',
      sequence: 5,
      sessionId: 'session-1',
      ok: 'true',
      hash: 'abc1234',
      subject: 'ok',
    },
    {
      type: 'turn.state',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'invented',
    },
    {
      type: 'user.message-meta',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: '',
    },
    {
      type: 'user.message-meta',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'm'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
    },
    {
      type: 'user.message-meta',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'sdk-message-1',
      extra: true,
    },
    {
      type: 'turn.error',
      sequence: 6,
      sessionId: 'session-1',
      turnId: 'turn-1',
      code: 'turn-failed',
      message: 'Failure',
      retryable: 'yes',
    },
    {
      type: 'host.connection',
      sequence: 7,
      sessionId: null,
      connection: { status: 'idle' },
      extra: true,
    },
    {
      type: 'interaction.request',
      sequence: 8,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'permission',
        tools: [],
        options: [
          {
            label: 'Allow',
            value: 'proceed_once',
            requiresEditedSpec: false,
          },
        ],
      },
    },
    {
      type: 'interaction.request',
      sequence: 8,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'permission',
        tools: [
          {
            toolUseId: 'tool-1',
            toolName: 'Execute',
            confirmationKind: 'unknown',
            title: 'Run command',
          },
        ],
        options: [],
      },
    },
    {
      type: 'interaction.request',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-2',
        kind: 'ask-user',
        toolCallId: 'tool-call-1',
        questions: [],
      },
    },
    {
      type: 'interaction.request',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-2',
        kind: 'ask-user',
        toolCallId: 'tool-call-1',
        questions: [
          {
            index: 0,
            topic: 'Environment',
            question: '',
            options: ['Staging'],
            multiSelect: false,
          },
        ],
      },
    },
    {
      type: 'interaction.closed',
      sequence: 10,
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: '',
    },
  ])('rejects malformed host input %#', (message) => {
    expect(readHostMessage(message)).toBeUndefined();
  });

  it('accepts exact boundary values', () => {
    expect(
      readHostMessage({
        type: 'thinking.delta',
        sequence: Number.MAX_SAFE_INTEGER,
        sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
        turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
        delta: 'x'.repeat(MAX_THINKING_TEXT_LENGTH),
        truncated: true,
        segmentIndex: Number.MAX_SAFE_INTEGER,
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'assistant.delta',
        sequence: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        delta: 'x'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'thinking.complete',
        sequence: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        durationMs: Number.MAX_SAFE_INTEGER,
        segmentIndex: 0,
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        type: 'tool.activity',
        sequence: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'i'.repeat(MAX_BRIDGE_ID_LENGTH),
        toolName: 'n'.repeat(MAX_TOOL_NAME_LENGTH),
        action: 'Read workspace files',
        status: 'running',
        progressCount: 100,
        latestUpdateKind: 'message',
      }),
    ).toBeDefined();
  });

  it('accepts exact session snapshot boundaries', () => {
    const sessions = Array.from(
      { length: MAX_SESSION_CATALOG_ITEMS },
      (_, index) => ({
        id: `session-${index}`,
        title:
          index === 0
            ? 't'.repeat(MAX_SESSION_TITLE_LENGTH)
            : `Session ${index}`,
        messageCount:
          index === 0 ? Number.MAX_SAFE_INTEGER : index,
        modifiedTime: '2026-08-09T09:00:00.000Z',
        active: index === 0,
        isFavorite: index % 2 === 0,
      }),
    );
    const transcript = Array.from(
      { length: MAX_SESSION_TRANSCRIPT_ITEMS },
      (_, index) => ({
        id: `message-${index}`,
        kind: 'user' as const,
        text: index === 0 ? 'x'.repeat(MAX_TURN_TEXT_LENGTH) : 'Prompt',
      }),
    );
    const message = {
      type: 'host.snapshot',
      sequence: Number.MAX_SAFE_INTEGER,
      sessionId: 'session-0',
      connection: { status: 'connected' },
      turn: null,
      sessions: { status: 'ready', items: sessions, message: '' },
      settings: readySettings(),
      context: readyContext(),
      modelCatalog: readyModelCatalog(),
      transcript,
      historyStatus: 'complete',
      truncated: true,
    };

    expect(readHostMessage(message)).toEqual(message);
  });

  it('accepts worktree annotations and the create-capability flag', () => {
    const snapshot = createSessionSnapshot();
    const message = {
      ...snapshot,
      worktreeCreateAvailable: true,
      sessions: {
        ...snapshot.sessions,
        items: [
          {
            ...snapshot.sessions.items[0],
            worktree: {
              branch: 'main-wt',
              path: 'D:\\repo-wt-main-wt',
            },
          },
        ],
      },
    };
    expect(readHostMessage(message)).toEqual(message);

    // '' branch means host-side git recovery failed; still renderable.
    const emptyBranch = {
      ...snapshot,
      sessions: {
        ...snapshot.sessions,
        items: [
          {
            ...snapshot.sessions.items[0],
            worktree: { branch: '', path: 'D:\\repo-wt-main-wt' },
          },
        ],
      },
    };
    expect(readHostMessage(emptyBranch)).toEqual(emptyBranch);
  });

  it.each([
    { name: 'non-record worktree', worktree: 'main-wt' },
    { name: 'missing path', worktree: { branch: 'main-wt' } },
    {
      name: 'empty path',
      worktree: { branch: 'main-wt', path: '' },
    },
    {
      name: 'oversized branch',
      worktree: {
        branch: 'b'.repeat(MAX_WORKTREE_BRANCH_LENGTH + 1),
        path: 'D:\\repo-wt',
      },
    },
    {
      name: 'oversized path',
      worktree: {
        branch: 'main-wt',
        path: 'p'.repeat(MAX_WORKTREE_PATH_LENGTH + 1),
      },
    },
    {
      name: 'control character in path',
      worktree: { branch: 'main-wt', path: 'D:\\repo\u0000wt' },
    },
    {
      name: 'extra keys',
      worktree: {
        branch: 'main-wt',
        path: 'D:\\repo-wt',
        isNewlyCreated: true,
      },
    },
  ])('rejects hostile session worktree shapes ($name)', ({ worktree }) => {
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], worktree }],
        },
      }),
    ).toBeUndefined();
  });

  it('rejects non-true worktree capability flags', () => {
    const snapshot = createSessionSnapshot();
    // Hosts omit the flag instead of sending false; anything but
    // `true` is malformed.
    expect(
      readHostMessage({ ...snapshot, worktreeCreateAvailable: false }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...snapshot, worktreeCreateAvailable: 'yes' }),
    ).toBeUndefined();
  });

  it('accepts the btw capability flag with the omit-when-false contract', () => {
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({ ...snapshot, btwAvailable: true }),
    ).toEqual({ ...snapshot, btwAvailable: true });
    expect(
      readHostMessage({ ...snapshot, btwAvailable: false }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...snapshot, btwAvailable: 'yes' }),
    ).toBeUndefined();
  });

  it('accepts session.btw card states and rejects malformed ones', () => {
    const message = {
      type: 'session.btw',
      sequence: 3,
      sessionId: 'session-1',
      btw: {
        status: 'ready',
        entries: [
          {
            id: 'btw-1',
            question: 'What is this?',
            answer: 'A hidden fork.',
            state: 'done',
          },
        ],
      },
    };
    expect(readHostMessage(message)).toEqual({
      type: 'session.btw',
      sequence: 3,
      sessionId: 'session-1',
      btw: {
        status: 'ready',
        message: null,
        entries: [
          {
            id: 'btw-1',
            question: 'What is this?',
            answer: 'A hidden fork.',
            state: 'done',
            message: null,
          },
        ],
      },
    });

    expect(
      readHostMessage({ ...message, sequence: -1 }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...message,
        btw: { status: 'nonsense', entries: [] },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...message,
        btw: {
          status: 'ready',
          entries: [{ id: 'btw-1', question: '', answer: '', state: 'done' }],
        },
      }),
    ).toBeUndefined();
  });

  it('accepts an absolute workspace root on snapshots', () => {
    const snapshot = createSessionSnapshot();
    const message = {
      ...snapshot,
      workspaceRoot: 'd:\\E\\前端好玩的东西\\droidvisx',
    };
    expect(readHostMessage(message)).toEqual(message);
    // Hosts omit the root without a usable workspace.
    expect(readHostMessage(snapshot)).toEqual(snapshot);
  });

  it.each([
    { name: 'empty root', workspaceRoot: '' },
    { name: 'non-string root', workspaceRoot: 42 },
    {
      name: 'oversized root',
      workspaceRoot: `D:\\${'r'.repeat(MAX_OPEN_PATH_LENGTH)}`,
    },
    {
      name: 'control character in root',
      workspaceRoot: 'D:\\repo\u0000root',
    },
  ])('rejects hostile workspace roots ($name)', ({ workspaceRoot }) => {
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({ ...snapshot, workspaceRoot }),
    ).toBeUndefined();
  });

  it('accepts session token usage on snapshots and as a state message', () => {
    const snapshot = createSessionSnapshot();
    const withUsage = {
      ...snapshot,
      tokenUsage: {
        cumulative: tokenUsageFixture(),
        lastTurn: { ...tokenUsageFixture(), factoryCredits: 0.5 },
      },
    };
    expect(readHostMessage(withUsage)).toEqual(withUsage);

    const seedOnly = {
      ...snapshot,
      tokenUsage: { cumulative: tokenUsageFixture(), lastTurn: null },
    };
    expect(readHostMessage(seedOnly)).toEqual(seedOnly);

    const message = {
      type: 'session.tokenUsage',
      sequence: 4,
      sessionId: 'session-1',
      tokenUsage: {
        cumulative: tokenUsageFixture(),
        lastTurn: null,
      },
    };
    expect(readHostMessage(message)).toEqual(message);
  });

  it.each([
    { name: 'non-record state', tokenUsage: 'lots' },
    {
      name: 'missing lastTurn member',
      tokenUsage: { cumulative: null },
    },
    {
      name: 'extra state keys',
      tokenUsage: { cumulative: null, lastTurn: null, costUsd: 1 },
    },
    {
      name: 'negative token count',
      tokenUsage: {
        cumulative: { ...tokenUsageFixture(), inputTokens: -1 },
        lastTurn: null,
      },
    },
    {
      name: 'fractional token count',
      tokenUsage: {
        cumulative: { ...tokenUsageFixture(), outputTokens: 1.5 },
        lastTurn: null,
      },
    },
    {
      name: 'missing breakdown field',
      tokenUsage: {
        cumulative: (() => {
          const { thinkingTokens: _omitted, ...rest } = tokenUsageFixture();
          return rest;
        })(),
        lastTurn: null,
      },
    },
    {
      name: 'extra breakdown keys',
      tokenUsage: {
        cumulative: { ...tokenUsageFixture(), totalCost: 3 },
        lastTurn: null,
      },
    },
    {
      name: 'negative factoryCredits',
      tokenUsage: {
        cumulative: { ...tokenUsageFixture(), factoryCredits: -1 },
        lastTurn: null,
      },
    },
  ])(
    'rejects malformed token usage on snapshots and messages ($name)',
    ({ tokenUsage }) => {
      const snapshot = createSessionSnapshot();
      expect(
        readHostMessage({ ...snapshot, tokenUsage }),
      ).toBeUndefined();
      expect(
        readHostMessage({
          type: 'session.tokenUsage',
          sequence: 4,
          sessionId: 'session-1',
          tokenUsage,
        }),
      ).toBeUndefined();
    },
  );

  it('defaults a missing favorite flag to false', () => {
    const snapshot = createSessionSnapshot();
    const { isFavorite: _omitted, ...summaryWithoutFavorite } =
      snapshot.sessions.items[0];
    const parsed = readHostMessage({
      ...snapshot,
      sessions: {
        ...snapshot.sessions,
        items: [summaryWithoutFavorite],
      },
    });
    expect(parsed).toEqual(snapshot);
  });

  it.each([
    {
      name: 'catalog status',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: { ...snapshot.sessions, status: 'failed' },
      }),
    },
    {
      name: 'history status',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        historyStatus: 'loading',
      }),
    },
    {
      name: 'message count',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], messageCount: -1 }],
        },
      }),
    },
    {
      name: 'modified date',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [
            {
              ...snapshot.sessions.items[0],
              modifiedTime: 'August 9, 2026',
            },
          ],
        },
      }),
    },
    {
      name: 'oversized title',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [
            {
              ...snapshot.sessions.items[0],
              title: 't'.repeat(MAX_SESSION_TITLE_LENGTH + 1),
            },
          ],
        },
      }),
    },
    {
      name: 'control-bearing title',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], title: 'Bad\u0000title' }],
        },
      }),
    },
    {
      name: 'non-boolean favorite flag',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], isFavorite: 'yes' }],
        },
      }),
    },
    {
      name: 'oversized catalog',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: Array.from(
            { length: MAX_SESSION_CATALOG_ITEMS + 1 },
            (_, index) => ({
              id: `session-${index}`,
              title: `Session ${index}`,
              messageCount: 0,
              modifiedTime: '2026-08-09T09:00:00.000Z',
              active: index === 0,
            }),
          ),
        },
      }),
    },
    {
      name: 'oversized transcript',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        transcript: Array.from(
          { length: MAX_SESSION_TRANSCRIPT_ITEMS + 1 },
          (_, index) => ({
            id: `message-${index}`,
            kind: 'user',
            text: 'Prompt',
          }),
        ),
      }),
    },
    {
      name: 'oversized transcript text budget',
      mutate: (snapshot: ReturnType<typeof createSessionSnapshot>) => ({
        ...snapshot,
        transcript: Array.from({ length: 6 }, (_, index) => ({
          id: `message-${index}`,
          kind: 'user',
          text: 'x'.repeat(MAX_TURN_TEXT_LENGTH),
        })),
      }),
    },
  ])('rejects invalid session snapshot $name', ({ mutate }) => {
    expect(readHostMessage(mutate(createSessionSnapshot()))).toBeUndefined();
  });

  it('rejects incoherent active-session snapshots', () => {
    const snapshot = createSessionSnapshot();

    expect(
      readHostMessage({
        ...snapshot,
        sessionId: null,
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...snapshot,
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], active: false }],
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...snapshot,
        historyStatus: 'unavailable',
      }),
    ).toBeUndefined();
  });

  // Early recovery snapshots go out while the catalog is still loading
  // and no runtime owns the session; the catalog then has no active
  // row even though sessionId is set. These used to be rejected
  // wholesale, which silently disabled recovery speed-up.
  it('accepts a connecting recovery snapshot whose catalog has no active row yet', () => {
    const early = {
      ...createSessionSnapshot(),
      connection: { status: 'connecting' as const },
      sessions: { status: 'loading' as const, items: [] },
    };
    expect(readHostMessage(early)).toEqual(early);
  });

  it('accepts an unavailable failed-activation snapshot without an active row', () => {
    const snapshot = createSessionSnapshot();
    const failed = {
      ...snapshot,
      connection: {
        status: 'unavailable' as const,
        message: 'The selected session could not be resumed.',
      },
      sessions: {
        ...snapshot.sessions,
        items: [{ ...snapshot.sessions.items[0], active: false }],
      },
    };
    expect(readHostMessage(failed)).toEqual(failed);
  });

  it('rejects a connecting snapshot whose active row contradicts the session id', () => {
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({
        ...snapshot,
        connection: { status: 'connecting' },
        sessions: {
          ...snapshot.sessions,
          items: [{ ...snapshot.sessions.items[0], id: 'session-2' }],
        },
      }),
    ).toBeUndefined();
  });

  it('rejects unsafe or malformed transcript projections', () => {
    const snapshot = createSessionSnapshot();
    const tool = {
      id: 'tool-1',
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      toolName: 'Execute',
      action: 'Ran a local command',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
    };

    for (const transcript of [
      [{ ...tool, input: { command: 'sensitive' } }],
      [{ ...tool, result: 'raw result' }],
      [{ ...tool, error: 'raw error' }],
      [
        { id: 'duplicate', kind: 'user', text: 'One' },
        { id: 'duplicate', kind: 'assistant', turnId: 'turn-1', text: 'Two' },
      ],
      [
        {
          id: 'thinking-1',
          kind: 'thinking',
          turnId: 'turn-1',
          text: 'Thought',
          status: 'invented',
          truncated: false,
        },
      ],
      [
        {
          id: 'diagnostic-1',
          kind: 'diagnostic',
          turnId: null,
          severity: 'fatal',
          code: 'unsafe',
          message: 'Unsafe',
        },
      ],
      // Sent-attachment metadata: kind whitelist, exact keys, and
      // no payload bytes smuggled alongside the summary.
      [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Prompt',
          attachments: [
            { kind: 'archive', name: 'a.zip', sizeBytes: 1 },
          ],
        },
      ],
      [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Prompt',
          attachments: [
            { kind: 'text', name: 'a.md', sizeBytes: 1, data: 'raw' },
          ],
        },
      ],
      [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Prompt',
          attachments: [
            { kind: 'text', name: '', sizeBytes: 1 },
          ],
        },
      ],
      [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Prompt',
          attachments: Array.from({ length: 9 }, (_, index) => ({
            kind: 'text',
            name: `file-${index}.md`,
            sizeBytes: 1,
          })),
        },
      ],
    ]) {
      expect(readHostMessage({ ...snapshot, transcript })).toBeUndefined();
    }
  });

  it('rejects hostile image items and image messages', () => {
    const item = {
      id: 'image-1',
      kind: 'image',
      turnId: 'turn-1',
      origin: 'tool-result',
      mediaType: 'image/png',
      data: 'aGVsbG8=',
      generated: false,
      byteLength: 5,
    };
    const message = {
      type: 'transcript.image',
      sequence: 7,
      sessionId: 'session-1',
      turnId: 'turn-1',
      item,
    };

    expect(readHostMessage(message)).toEqual(message);
    for (const hostileItem of [
      // Media type smuggling: only the four raster types may build a
      // data URI, never text/html or svg.
      { ...item, mediaType: 'text/html' },
      { ...item, mediaType: 'image/svg+xml' },
      { ...item, mediaType: 'IMAGE/PNG' },
      // Payload must be pure base64, not a full data URI or script.
      { ...item, data: 'data:text/html;base64,aGVsbG8=' },
      { ...item, data: '<script>alert(1)</script>' },
      { ...item, data: 'aGVsbG8='.repeat(400_000) },
      { ...item, origin: 'system' },
      { ...item, generated: 'yes' },
      { ...item, byteLength: -1 },
      { ...item, byteLength: 5.5 },
      { ...item, turnId: 'turn-2' },
      { ...item, extra: true },
      { ...item, kind: 'document' },
    ]) {
      expect(
        readHostMessage({ ...message, item: hostileItem }),
      ).toBeUndefined();
    }

    // Snapshot transcripts reject image items the same way and cap the
    // total image payload budget.
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({
        ...snapshot,
        transcript: [{ ...item, mediaType: 'text/html' }],
      }),
    ).toBeUndefined();
    const oneMegaChars = 'A'.repeat(2_000_000);
    const overBudget = Array.from({ length: 9 }, (_, index) => ({
      ...item,
      id: `image-${index}`,
      data: oneMegaChars,
      byteLength: 1_500_000,
    }));
    expect(
      readHostMessage({ ...snapshot, transcript: overBudget }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...snapshot,
        transcript: overBudget.slice(0, 8),
      }),
    ).toBeDefined();
  });

  it('rejects hostile session snapshot nesting without throwing', () => {
    const snapshot = createSessionSnapshot();
    const summaryWithSymbol = {
      ...snapshot.sessions.items[0],
      [Symbol('extra')]: true,
    };
    const transcriptAccessor = {
      id: 'user-1',
      kind: 'user',
      get text() {
        throw new Error('hostile transcript');
      },
    };
    let kindAccessorCalls = 0;
    const kindAccessor = {
      id: 'user-1',
      text: 'Prompt',
      get kind() {
        kindAccessorCalls += 1;
        return 'user';
      },
    };
    const proxiedItems = new Proxy([...snapshot.sessions.items], {
      ownKeys() {
        throw new Error('hostile catalog');
      },
    });

    expect(
      readHostMessage({
        ...snapshot,
        sessions: { ...snapshot.sessions, items: [summaryWithSymbol] },
      }),
    ).toBeUndefined();
    expect(() =>
      readHostMessage({ ...snapshot, transcript: [transcriptAccessor] }),
    ).not.toThrow();
    expect(
      readHostMessage({ ...snapshot, transcript: [transcriptAccessor] }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...snapshot, transcript: [kindAccessor] }),
    ).toBeUndefined();
    expect(kindAccessorCalls).toBe(0);
    expect(() =>
      readHostMessage({
        ...snapshot,
        sessions: { ...snapshot.sessions, items: proxiedItems },
      }),
    ).not.toThrow();
    expect(
      readHostMessage({
        ...snapshot,
        sessions: { ...snapshot.sessions, items: proxiedItems },
      }),
    ).toBeUndefined();
  });

  it('rejects hostile host objects and accessors without throwing', () => {
    const proxy = new Proxy(
      {
        type: 'host.connection',
        sequence: 0,
        sessionId: null,
        connection: { status: 'idle' },
      },
      {
        get() {
          throw new Error('hostile object');
        },
      },
    );
    const accessor = {
      type: 'thinking.delta',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      truncated: false,
      segmentIndex: 0,
      get delta() {
        throw new Error('hostile getter');
      },
    };

    expect(() => readHostMessage(proxy)).not.toThrow();
    expect(readHostMessage(proxy)).toBeUndefined();
    expect(() => readHostMessage(accessor)).not.toThrow();
    expect(readHostMessage(accessor)).toBeUndefined();
  });

  it('rejects symbol keys and nested extra keys', () => {
    const symbolKey = {
      type: 'host.connection',
      sequence: 0,
      sessionId: null,
      connection: { status: 'idle' },
      [Symbol('extra')]: true,
    };
    const nestedExtra = {
      type: 'host.connection',
      sequence: 0,
      sessionId: null,
      connection: { status: 'idle', extra: true },
    };

    expect(readHostMessage(symbolKey)).toBeUndefined();
    expect(readHostMessage(nestedExtra)).toBeUndefined();
  });

  it('accepts every closed permission confirmation kind', () => {
    for (const confirmationKind of PERMISSION_CONFIRMATION_KINDS) {
      expect(
        readHostMessage({
          type: 'interaction.request',
          sequence: 0,
          sessionId: 'session-1',
          turnId: 'turn-1',
          request: {
            requestId: 'request-1',
            kind: 'permission',
            tools: [
              {
                toolUseId: 'tool-1',
                toolName: 'Tool',
                confirmationKind,
                title: 'Confirm tool',
              },
            ],
            options: [
              {
                label: 'Cancel',
                value: 'cancel',
                requiresEditedSpec: false,
              },
            ],
          },
        }),
      ).toBeDefined();
    }
  });

  it('accepts exact interaction request boundaries', () => {
    const permission = {
      type: 'interaction.request',
      sequence: Number.MAX_SAFE_INTEGER,
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
      turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
      request: {
        requestId: 'r'.repeat(MAX_BRIDGE_ID_LENGTH),
        kind: 'permission',
        tools: Array.from({ length: MAX_PERMISSION_TOOLS }, (_, index) => ({
          toolUseId: `tool-${index}`,
          toolName: 'n'.repeat(MAX_PERMISSION_TOOL_NAME_LENGTH),
          confirmationKind: 'exit_spec_mode',
          title:
            index === 0
              ? 't'.repeat(MAX_INTERACTION_TITLE_LENGTH)
              : 'Confirm',
          detail:
            index === 0
              ? 'd'.repeat(MAX_INTERACTION_DETAIL_LENGTH)
              : undefined,
          riskNote:
            index === 0
              ? 'r'.repeat(MAX_PERMISSION_RISK_NOTE_LENGTH)
              : undefined,
        })),
        options: Array.from(
          { length: MAX_PERMISSION_OPTIONS },
          (_, index) => ({
            label:
              index === 0
                ? 'l'.repeat(MAX_PERMISSION_OPTION_LABEL_LENGTH)
                : 'Allow',
            value:
              index === 0
                ? 'v'.repeat(MAX_PERMISSION_OPTION_VALUE_LENGTH)
                : `value-${index}`,
            requiresEditedSpec: index === 0,
          }),
        ),
        editableSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH),
      },
    };
    const askUser = {
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'ask-user',
        toolCallId: 'c'.repeat(MAX_BRIDGE_ID_LENGTH),
        questions: Array.from(
          { length: MAX_ASK_USER_QUESTIONS },
          (_, index) => ({
            index:
              index === MAX_ASK_USER_QUESTIONS - 1
                ? Number.MAX_SAFE_INTEGER
                : index,
            topic:
              index === 0
                ? 't'.repeat(MAX_ASK_USER_TOPIC_LENGTH)
                : 'Topic',
            question:
              index === 0
                ? 'q'.repeat(MAX_ASK_USER_QUESTION_LENGTH)
                : 'Question?',
            options: Array.from(
              { length: MAX_ASK_USER_OPTIONS },
              (__, optionIndex) =>
                index === 0 && optionIndex === 0
                  ? 'o'.repeat(MAX_ASK_USER_OPTION_LENGTH)
                  : `Option ${optionIndex}`,
            ),
            multiSelect: index % 2 === 0,
          }),
        ),
      },
    };

    expect(readHostMessage(permission)).toBeDefined();
    expect(readHostMessage(askUser)).toBeDefined();
  });

  it('accepts an ExitSpecMode plan far beyond the generic detail cap', () => {
    // Regression: plans over 32K used to be rejected here, which the
    // host surfaced as a silent cancellation of the whole approval.
    const plan = '# Plan\n'.repeat(1 + MAX_INTERACTION_DETAIL_LENGTH / 7);
    expect(plan.length).toBeGreaterThan(MAX_INTERACTION_DETAIL_LENGTH);
    expect(plan.length).toBeLessThanOrEqual(MAX_SPEC_PLAN_LENGTH);
    const message = readHostMessage({
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'permission',
        tools: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Ready to build',
            detail: plan,
          },
        ],
        options: [
          {
            label: 'Approve',
            value: 'proceed_new_session',
            requiresEditedSpec: false,
          },
        ],
        editableSpecContent: plan,
      },
    });
    expect(message).toBeDefined();
  });

  it('rejects over-limit interaction arrays and strings', () => {
    const permissionTool = {
      toolUseId: 'tool-1',
      toolName: 'Execute',
      confirmationKind: 'exit_spec_mode',
      title: 'Run command',
    };
    const permissionOption = {
      label: 'Allow',
      value: 'proceed_once',
      requiresEditedSpec: false,
    };
    const permission = {
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'permission',
        tools: [permissionTool],
        options: [permissionOption],
      },
    };
    const question = {
      index: 0,
      topic: 'Environment',
      question: 'Which environment?',
      options: ['Staging'],
      multiSelect: false,
    };
    const askUser = {
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'ask-user',
        toolCallId: 'tool-call-1',
        questions: [question],
      },
    };

    expect(
      readHostMessage({
        ...askUser,
        request: {
          ...askUser.request,
          questions: [{ ...question, options: [] }],
        },
      }),
    ).toBeDefined();
    expect(
      readHostMessage({
        ...permission,
        request: {
          ...permission.request,
          tools: Array(MAX_PERMISSION_TOOLS + 1).fill(permissionTool),
        },
      }),
    ).toBeUndefined();
    for (const tools of [
      [
        {
          ...permissionTool,
          toolName: 'n'.repeat(
            MAX_PERMISSION_TOOL_NAME_LENGTH + 1,
          ),
        },
      ],
      [
        {
          ...permissionTool,
          // The generic detail cap applies to non-spec kinds only.
          confirmationKind: 'exec',
          detail: 'd'.repeat(MAX_INTERACTION_DETAIL_LENGTH + 1),
        },
      ],
      [
        {
          ...permissionTool,
          detail: 'p'.repeat(MAX_SPEC_PLAN_LENGTH + 1),
        },
      ],
      [
        {
          ...permissionTool,
          riskNote: 'r'.repeat(
            MAX_PERMISSION_RISK_NOTE_LENGTH + 1,
          ),
        },
      ],
    ]) {
      expect(
        readHostMessage({
          ...permission,
          request: { ...permission.request, tools },
        }),
      ).toBeUndefined();
    }
    for (const options of [
      [
        {
          ...permissionOption,
          label: 'l'.repeat(
            MAX_PERMISSION_OPTION_LABEL_LENGTH + 1,
          ),
        },
      ],
      [
        {
          ...permissionOption,
          value: 'v'.repeat(
            MAX_PERMISSION_OPTION_VALUE_LENGTH + 1,
          ),
        },
      ],
    ]) {
      expect(
        readHostMessage({
          ...permission,
          request: { ...permission.request, options },
        }),
      ).toBeUndefined();
    }
    expect(
      readHostMessage({
        ...permission,
        request: {
          ...permission.request,
          options: Array(MAX_PERMISSION_OPTIONS + 1).fill(
            permissionOption,
          ),
        },
      }),
    ).toBeUndefined();
    for (const questions of [
      [
        {
          ...question,
          topic: 't'.repeat(MAX_ASK_USER_TOPIC_LENGTH + 1),
        },
      ],
      [
        {
          ...question,
          question: 'q'.repeat(MAX_ASK_USER_QUESTION_LENGTH + 1),
        },
      ],
      [
        {
          ...question,
          options: ['o'.repeat(MAX_ASK_USER_OPTION_LENGTH + 1)],
        },
      ],
    ]) {
      expect(
        readHostMessage({
          ...askUser,
          request: { ...askUser.request, questions },
        }),
      ).toBeUndefined();
    }
    expect(
      readHostMessage({
        ...permission,
        request: {
          ...permission.request,
          editableSpecContent: 'e'.repeat(
            MAX_EDITED_SPEC_LENGTH + 1,
          ),
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...permission,
        request: {
          ...permission.request,
          tools: [
            {
              ...permissionTool,
              title: 't'.repeat(MAX_INTERACTION_TITLE_LENGTH + 1),
            },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...askUser,
        request: {
          ...askUser.request,
          questions: Array(MAX_ASK_USER_QUESTIONS + 1).fill(question),
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...askUser,
        request: {
          ...askUser.request,
          questions: [
            {
              ...question,
              options: Array(MAX_ASK_USER_OPTIONS + 1).fill('Option'),
            },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...askUser,
        request: {
          ...askUser.request,
          questions: [
            {
              ...question,
              options: [''],
            },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it('rejects duplicate question indices and exact-shape violations', () => {
    const question = {
      index: 0,
      topic: 'Environment',
      question: 'Which environment?',
      options: ['Staging'],
      multiSelect: false,
    };
    const base = {
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request: {
        requestId: 'request-1',
        kind: 'ask-user',
        toolCallId: 'tool-call-1',
        questions: [question],
      },
    };

    expect(
      readHostMessage({
        ...base,
        request: {
          ...base.request,
          questions: [question, { ...question, question: 'Again?' }],
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...base,
        request: {
          ...base.request,
          questions: [{ ...question, extra: true }],
        },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...base,
        request: { ...base.request, extra: true },
      }),
    ).toBeUndefined();

    const options = ['Staging'];
    Object.defineProperty(options, 'extra', { value: true });
    expect(
      readHostMessage({
        ...base,
        request: {
          ...base.request,
          questions: [{ ...question, options }],
        },
      }),
    ).toBeUndefined();

    const sparseOptions = new Array(1);
    expect(
      readHostMessage({
        ...base,
        request: {
          ...base.request,
          questions: [{ ...question, options: sparseOptions }],
        },
      }),
    ).toBeUndefined();
  });

  it('rejects nested symbols, accessors, and proxies without throwing', () => {
    const requestWithSymbol = {
      requestId: 'request-1',
      kind: 'permission',
      tools: [
        {
          toolUseId: 'tool-1',
          toolName: 'Execute',
          confirmationKind: 'exec',
          title: 'Run command',
          [Symbol('extra')]: true,
        },
      ],
      options: [
        {
          label: 'Allow',
          value: 'proceed_once',
          requiresEditedSpec: false,
        },
      ],
    };
    const accessor = {
      requestId: 'request-1',
      kind: 'ask-user',
      toolCallId: 'tool-call-1',
      questions: [
        {
          index: 0,
          topic: 'Environment',
          get question() {
            throw new Error('hostile question');
          },
          options: ['Staging'],
          multiSelect: false,
        },
      ],
    };
    const proxy = new Proxy(
      {
        requestId: 'request-1',
        kind: 'permission',
        tools: [],
        options: [],
      },
      {
        ownKeys() {
          throw new Error('hostile request');
        },
      },
    );
    const message = (request: unknown) => ({
      type: 'interaction.request',
      sequence: 0,
      sessionId: 'session-1',
      turnId: 'turn-1',
      request,
    });

    expect(readHostMessage(message(requestWithSymbol))).toBeUndefined();
    expect(() => readHostMessage(message(accessor))).not.toThrow();
    expect(readHostMessage(message(accessor))).toBeUndefined();
    expect(() => readHostMessage(message(proxy))).not.toThrow();
    expect(readHostMessage(message(proxy))).toBeUndefined();
  });

  it('accepts a bounded failure excerpt on tool rows and rejects abuse', () => {
    const failed = {
      type: 'tool.activity',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'ApplyPatch',
      action: 'Updated workspace files',
      status: 'failed',
      progressCount: 0,
      latestUpdateKind: null,
      errorMessage: 'Tool execution cancelled by user',
    };
    expect(readHostMessage(failed)).toEqual(failed);

    // Over the cap or empty: the whole message is rejected.
    expect(
      readHostMessage({
        ...failed,
        errorMessage: 'x'.repeat(MAX_TOOL_ERROR_MESSAGE_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...failed, errorMessage: '' }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...failed, errorMessage: 42 }),
    ).toBeUndefined();

    // Snapshot transcript items accept the same optional field.
    const snapshot = createSessionSnapshot();
    const replayed = {
      ...snapshot,
      transcript: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-use-1',
          toolName: 'ApplyPatch',
          action: 'Updated workspace files',
          status: 'failed',
          progressCount: 0,
          latestUpdateKind: null,
          errorMessage: 'Tool execution cancelled by user',
        },
      ],
    };
    expect(readHostMessage(replayed)).toEqual(replayed);
  });

  it('accepts a bounded execute output tail and rejects abuse', () => {
    const running = {
      type: 'tool.activity',
      sequence: 6,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Execute',
      action: 'Ran a local command',
      status: 'running',
      progressCount: 3,
      latestUpdateKind: 'status',
      detailKind: 'command',
      detail: 'pnpm test',
      outputTail: 'line-1\nline-2\nline-3',
    };
    expect(readHostMessage(running)).toEqual(running);

    // Over the cap or empty: the whole message is rejected.
    expect(
      readHostMessage({
        ...running,
        outputTail: 'x'.repeat(MAX_TOOL_OUTPUT_TAIL_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...running, outputTail: '' }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...running, outputTail: 42 }),
    ).toBeUndefined();

    // Snapshot transcript items accept the same optional field, so a
    // completed execute row keeps its final tail across re-renders.
    const snapshot = createSessionSnapshot();
    const replayed = {
      ...snapshot,
      transcript: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-use-1',
          toolName: 'Execute',
          action: 'Ran a local command',
          status: 'completed',
          progressCount: 4,
          latestUpdateKind: 'status',
          outputTail: 'final output line',
        },
      ],
    };
    expect(readHostMessage(replayed)).toEqual(replayed);
    expect(
      readHostMessage({
        ...snapshot,
        transcript: [
          {
            ...replayed.transcript[0],
            outputTail: 'x'.repeat(MAX_TOOL_OUTPUT_TAIL_LENGTH + 1),
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('accepts delegated subagent summaries on tool rows', () => {
    const activity = {
      type: 'tool.activity',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      subagent: {
        type: 'code-reviewer',
        description: 'Review the bridge validation changes',
        status: 'running',
      },
    };
    expect(readHostMessage(activity)).toEqual(activity);

    const completed = {
      ...activity,
      status: 'completed',
      subagent: {
        type: 'code-reviewer',
        description: 'Review the bridge validation changes',
        status: 'completed',
        toolUseCount: 12,
        durationMs: 48_500,
      },
    };
    expect(readHostMessage(completed)).toEqual(completed);

    // Status, counters, and duration stay optional until the SDK
    // reports them.
    const bare = {
      ...activity,
      subagent: { type: 'explorer', description: '' },
    };
    expect(readHostMessage(bare)).toEqual(bare);

    const snapshot = createSessionSnapshot();
    const replayed = {
      ...snapshot,
      transcript: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-use-1',
          toolName: 'Task',
          action: 'Delegated to a subagent',
          status: 'completed',
          progressCount: 1,
          latestUpdateKind: 'tool-result',
          subagent: {
            type: 'explorer',
            description: 'Find the session catalog wiring',
            status: 'completed',
            toolUseCount: 4,
            durationMs: 9_000,
          },
        },
      ],
    };
    expect(readHostMessage(replayed)).toEqual(replayed);

    const boundary = {
      ...activity,
      subagent: {
        type: 't'.repeat(MAX_SUBAGENT_TYPE_LENGTH),
        description: 'd'.repeat(MAX_SUBAGENT_DESCRIPTION_LENGTH),
        status: 'pending',
        toolUseCount: 0,
        durationMs: 0,
      },
    };
    expect(readHostMessage(boundary)).toEqual(boundary);
  });

  it.each([
    { type: '', description: 'Valid' },
    { type: 't'.repeat(MAX_SUBAGENT_TYPE_LENGTH + 1), description: '' },
    { type: 'ctrl\u0000type', description: '' },
    {
      type: 'explorer',
      description: 'd'.repeat(MAX_SUBAGENT_DESCRIPTION_LENGTH + 1),
    },
    { type: 'explorer', description: 'line\nbreak' },
    { type: 'explorer', description: '', status: 'exploded' },
    { type: 'explorer', description: '', toolUseCount: -1 },
    { type: 'explorer', description: '', toolUseCount: 1.5 },
    { type: 'explorer', description: '', durationMs: -1 },
    { type: 'explorer', description: '', childSessionId: 'leak' },
    { type: 'explorer' },
  ])('rejects malformed subagent summaries %#', (subagent) => {
    expect(
      readHostMessage({
        type: 'tool.activity',
        sequence: 5,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Task',
        action: 'Delegated to a subagent',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
        subagent,
      }),
    ).toBeUndefined();
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({
        ...snapshot,
        transcript: [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'tool-use-1',
            toolName: 'Task',
            action: 'Delegated to a subagent',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
            subagent,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('accepts background hints on tool rows', () => {
    const activity = {
      type: 'tool.activity',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Execute',
      action: 'Ran a local command',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      backgroundHint: { fireAndForget: true },
    };
    expect(readHostMessage(activity)).toEqual(activity);

    const snapshot = createSessionSnapshot();
    const replayed = {
      ...snapshot,
      transcript: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-use-1',
          toolName: 'Execute',
          action: 'Ran a local command',
          status: 'stopped',
          progressCount: 0,
          latestUpdateKind: null,
          backgroundHint: { fireAndForget: true },
        },
      ],
    };
    expect(readHostMessage(replayed)).toEqual(replayed);
  });

  it.each([
    {},
    { fireAndForget: 'true' },
    { fireAndForget: 1 },
    { fireAndForget: null },
    { fireAndForget: true, pid: 12468 },
    'fireAndForget',
    true,
    [{ fireAndForget: true }],
  ])('rejects malformed background hints %#', (backgroundHint) => {
    expect(
      readHostMessage({
        type: 'tool.activity',
        sequence: 5,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Execute',
        action: 'Ran a local command',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
        backgroundHint,
      }),
    ).toBeUndefined();
    const snapshot = createSessionSnapshot();
    expect(
      readHostMessage({
        ...snapshot,
        transcript: [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'tool-use-1',
            toolName: 'Execute',
            action: 'Ran a local command',
            status: 'stopped',
            progressCount: 0,
            latestUpdateKind: null,
            backgroundHint,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('accepts read-only mission identity on snapshots and catalogs', () => {
    const snapshot = createSessionSnapshot();
    const orchestrator = {
      ...snapshot,
      mission: { state: 'running', role: 'orchestrator' },
    };
    expect(readHostMessage(orchestrator)).toEqual(orchestrator);

    // Either half may be unknown as long as one is present.
    const stateOnly = {
      ...snapshot,
      mission: { state: 'paused', role: null },
    };
    expect(readHostMessage(stateOnly)).toEqual(stateOnly);
    const roleOnly = {
      ...snapshot,
      mission: { state: null, role: 'worker' },
    };
    expect(readHostMessage(roleOnly)).toEqual(roleOnly);

    const withRole = {
      ...snapshot,
      sessions: {
        ...snapshot.sessions,
        items: [
          {
            ...snapshot.sessions.items[0],
            missionRole: 'worker' as const,
          },
        ],
      },
    };
    expect(readHostMessage(withRole)).toEqual(withRole);
  });

  it.each([
    { state: 'exploded', role: null },
    { state: null, role: 'bystander' },
    { state: null, role: null },
    { state: 'running' },
    { state: 'running', role: null, extra: true },
  ])('rejects malformed mission summaries %#', (mission) => {
    expect(
      readHostMessage({ ...createSessionSnapshot(), mission }),
    ).toBeUndefined();
  });

  it('rejects mission identity without an active session', () => {
    expect(
      readHostMessage({
        type: 'host.snapshot',
        sequence: 0,
        sessionId: null,
        connection: { status: 'idle' },
        turn: null,
        sessions: { status: 'idle', items: [] },
        settings: { status: 'loading', value: null },
        context: { status: 'loading', value: null },
        modelCatalog: { status: 'loading', items: [] },
        transcript: [],
        historyStatus: 'unavailable',
        truncated: false,
        mission: { state: 'running', role: 'orchestrator' },
      }),
    ).toBeUndefined();
  });

  it('rejects invalid catalog mission roles', () => {
    const snapshot = createSessionSnapshot();
    for (const missionRole of ['manager', '', 0, null]) {
      expect(
        readHostMessage({
          ...snapshot,
          sessions: {
            ...snapshot.sessions,
            items: [{ ...snapshot.sessions.items[0], missionRole }],
          },
        }),
      ).toBeUndefined();
    }
  });
});

function createSessionSnapshot(): Extract<
  HostToWebviewMessage,
  { type: 'host.snapshot' }
> {
  return {
    type: 'host.snapshot',
    sequence: 0,
    sessionId: 'session-1',
    connection: { status: 'connected' },
    turn: null,
    sessions: {
      status: 'ready',
      items: [
        {
          id: 'session-1',
          title: 'Session one',
          messageCount: 1,
          modifiedTime: '2026-08-09T09:00:00.000Z',
          active: true,
          isFavorite: false,
        },
      ],
    },
    settings: readySettings(),
    context: readyContext(),
    modelCatalog: readyModelCatalog(),
    transcript: [{ id: 'user-1', kind: 'user', text: 'Prompt' }],
    historyStatus: 'complete',
    truncated: false,
  };
}

function tokenUsageFixture() {
  // Live values from artifacts/probe-token-usage.out.json.
  return {
    inputTokens: 2565,
    outputTokens: 81,
    cacheReadTokens: 23552,
    cacheCreationTokens: 0,
    thinkingTokens: 62,
  };
}

function readySettings() {
  return {
    status: 'ready' as const,
    value: {
      interactionMode: 'auto' as const,
      modelId: 'factory/gpt-5.6-sol',
      reasoningEffort: 'high' as const,
      autonomyLevel: 'medium' as const,
      specModeModelId: null,
      specModeReasoningEffort: null,
    },
  };
}

function readyContext() {
  return {
    status: 'ready' as const,
    value: {
      used: 25_000,
      remaining: 175_000,
      limit: 200_000,
      accuracy: 'exact' as const,
    },
  };
}

function readyModelCatalog() {
  return {
    status: 'ready' as const,
    items: [
      {
        id: 'factory/gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        supportedReasoningEfforts: ['medium', 'high'] as const,
      },
    ],
  };
}
