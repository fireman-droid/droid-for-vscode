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
  MAX_SESSION_TITLE_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_THINKING_TEXT_LENGTH,
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
          },
        ],
      },
      settings: readySettings(),
      context: readyContext(),
      modelCatalog: readyModelCatalog(),
      transcript: [
        { id: 'user-1', kind: 'user', text: 'Implement sessions.' },
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
    },
    {
      type: 'thinking.complete',
      sequence: 4,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: null,
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
      type: 'runtime.diagnostic',
      sequence: 8,
      sessionId: 'session-1',
      turnId: 'turn-1',
      severity: 'warning',
      code: 'diagnostic-code',
      message: 'Safe diagnostic',
    },
    {
      type: 'turn.state',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'streaming',
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
    },
    {
      type: 'thinking.delta',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Considering',
      truncated: 'no',
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: -1,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 1.5,
    },
    {
      type: 'thinking.complete',
      sequence: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: Number.MAX_SAFE_INTEGER + 1,
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
      type: 'turn.state',
      sequence: 5,
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'invented',
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
    ]) {
      expect(readHostMessage({ ...snapshot, transcript })).toBeUndefined();
    }
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
          detail: 'd'.repeat(MAX_INTERACTION_DETAIL_LENGTH + 1),
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

function readySettings() {
  return {
    status: 'ready' as const,
    value: {
      interactionMode: 'auto' as const,
      modelId: 'factory/gpt-5.6-sol',
      reasoningEffort: 'high' as const,
      autonomyLevel: 'medium' as const,
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
