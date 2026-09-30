import { type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { UNAVAILABLE_IDE } from '../../shared/protocol/ideProtocol';
import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import { createAcceptanceScenarios } from './acceptanceScenarios';
import { chatRegionTranscript } from './chatRegionScenario';

export const STUDIO_SCENARIO_IDS = [
  'full-workflow',
  'chat-region',
  'conversation',
  'streaming',
  'plan',
  'ask-user',
  'ask-user-result',
  'review',
  'subagent',
  'permission',
  'queued-attachments',
  'long-history',
  'failure',
  'empty',
] as const;

export type StudioScenarioId = (typeof STUDIO_SCENARIO_IDS)[number];
export type StudioSequence = () => number;

export interface StudioScenario {
  readonly id: StudioScenarioId;
  readonly label: string;
  readonly description: string;
  readonly build: (nextSequence: StudioSequence) => readonly HostToWebviewMessage[];
}

const SESSION_ID = 'studio-session';
const MODEL_ID = 'factory/gpt-5.6';

type SnapshotMessage = Extract<HostToWebviewMessage, { type: 'host.snapshot' }>;

function baseSnapshot(
  nextSequence: StudioSequence,
  transcript: readonly SessionTranscriptItem[],
  options: {
    readonly turn?: SnapshotMessage['turn'];
    readonly historyStatus?: SnapshotMessage['historyStatus'];
    readonly truncated?: boolean;
    readonly connection?: SnapshotMessage['connection'];
  } = {},
): SnapshotMessage {
  return {
    type: 'host.snapshot',
    sequence: nextSequence(),
    conversationId: SESSION_ID,
    sessionId: SESSION_ID,
    connection: options.connection ?? { status: 'connected' },
    ide: UNAVAILABLE_IDE,
    turn: options.turn ?? null,
    sessions: {
      status: 'ready',
      items: [
        {
          id: SESSION_ID,
          title: 'Scenario Studio',
          messageCount: transcript.length,
          modifiedTime: '2026-08-23T12:00:00.000Z',
          active: true,
          isFavorite: true,
        },
        {
          id: 'studio-reference',
          title: 'Previous design review',
          messageCount: 18,
          modifiedTime: '2026-08-22T09:30:00.000Z',
          active: false,
          isFavorite: false,
        },
      ],
    },
    settings: {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: MODEL_ID,
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      },
    },
    context: {
      status: 'ready',
      value: {
        availability: 'available',
        used: 24_000,
        remaining: 176_000,
        limit: 200_000,
      },
    },
    modelCatalog: {
      status: 'ready',
      items: [
        {
          id: MODEL_ID,
          displayName: 'GPT-5.6',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'low', isCustom: false, supportsImages: true, supportsImageGeneration: false, disabled: false,
        },
        {
          id: 'factory/claude-opus-4-6',
          displayName: 'Claude Opus 4.6',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'low', isCustom: false, supportsImages: true, supportsImageGeneration: false, disabled: false,
        },
      ],
    },
    transcript,
    historyStatus: options.historyStatus ?? 'complete',
    truncated: options.truncated ?? false,
    btwAvailable: true,
    backgroundTurnsAvailable: true,
    workspaceRoot: 'D:\\workspace\\droidvisx',
  };
}

function conversation(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'conversation-user-1',
      kind: 'user',
      messageId: 'message-conversation-1',
      text: 'Review the current Webview architecture and summarize the risks.',
    },
    {
      id: 'conversation-assistant-1',
      kind: 'assistant',
      turnId: 'conversation-turn-1',
      text: [
        'The Webview already keeps a clean runtime boundary.',
        '',
        '### What is working',
        '',
        '- Host messages pass through an exact validator.',
        '- The assistant runtime consumes projected presentation state.',
        '- Session ownership remains in the Extension Host.',
        '',
        'The next useful step is to keep scenario fixtures on the same bridge path.',
      ].join('\n'),
    },
    {
      id: 'conversation-user-2',
      kind: 'user',
      messageId: 'message-conversation-2',
      text: 'Show me one concrete example.',
    },
    {
      id: 'conversation-assistant-2',
      kind: 'assistant',
      turnId: 'conversation-turn-2',
      text: 'Open `src/webview-v2/dev/scenarios.ts` and switch the URL to `?scenario=streaming`.',
    },
  ];
  return [baseSnapshot(nextSequence, transcript)];
}

function streaming(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'streaming-turn';
  return [
    baseSnapshot(
      nextSequence,
      [
        {
          id: 'streaming-user',
          kind: 'user',
          messageId: 'message-streaming',
          text: 'Inspect the Webview and implement the scenario controller.',
        },
      ],
      { turn: { turnId, status: 'streaming' } },
    ),
    {
      type: 'thinking.delta',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      delta:
        'I am tracing the existing bridge and identifying the smallest reusable transport.',
      truncated: false,
      segmentIndex: 0,
    },
    {
      type: 'tool.activity',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      toolUseId: 'streaming-read',
      toolName: 'Read',
      action: 'Read Webview bridge files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
      durationMs: 842,
      filePath: 'src/webview-v2/bridge/vscode.ts',
      target: 'src/webview-v2/bridge/vscode.ts',
    },
    {
      type: 'tool.activity',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      toolUseId: 'streaming-execute',
      toolName: 'Execute',
      action: 'Ran focused TypeScript checks',
      status: 'running',
      progressCount: 2,
      latestUpdateKind: 'status',
      detailKind: 'command',
      detail: 'pnpm exec tsc -p src/webview-v2/tsconfig.json --noEmit',
      outputTail:
        '> droidvisx@0.7.89 typecheck:webview\n> tsc -p src/webview-v2/tsconfig.json --noEmit\n',
    },
    {
      type: 'assistant.delta',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      delta: 'The typed scenario registry is now connected to the production reducer.',
    },
  ];
}

function plan(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'plan-turn';
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'plan-user',
      kind: 'user',
      messageId: 'message-plan',
      text: 'Plan the Scenario Studio implementation.',
    },
    {
      id: 'plan-tool',
      kind: 'tool',
      turnId,
      toolUseId: 'plan-todo',
      toolName: 'TodoWrite',
      action: 'Updated the implementation plan',
      status: 'running',
      progressCount: 1,
      latestUpdateKind: 'status',
      detailKind: 'plan',
      detail: [
        '1. [completed] Inspect the existing Webview Lab',
        '2. [in_progress] Build the typed scenario registry',
        '3. [pending] Add browser controls and URL state',
        '4. [pending] Run focused validation',
      ].join('\n'),
    },
  ];
  return [
    baseSnapshot(nextSequence, transcript, {
      turn: { turnId, status: 'streaming' },
    }),
    {
      type: 'interaction.request',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      request: {
        requestId: 'plan-approval',
        kind: 'permission',
        tools: [
          {
            toolUseId: 'plan-exit-spec',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Approve the Scenario Studio implementation plan',
          },
        ],
        options: [
          {
            label: 'Keep planning',
            value: 'deny',
            requiresEditedSpec: false,
          },
          {
            label: 'Edit plan',
            value: 'proceed_edit',
            requiresEditedSpec: true,
          },
          {
            label: 'Proceed with implementation',
            value: 'proceed_once',
            requiresEditedSpec: false,
          },
        ],
        editableSpecContent: [
          '## Scenario Studio',
          '',
          '1. Reuse the production App and bridge validator.',
          '2. Add deterministic scenario, theme, and viewport controls.',
          '3. Keep the Droid runtime outside the browser.',
        ].join('\n'),
      },
    },
  ];
}

function askUser(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'ask-user-turn';
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'ask-user-prompt',
      kind: 'user',
      messageId: 'message-ask-user',
      text: 'Prepare the visual review workspace.',
    },
    {
      id: 'ask-user-assistant',
      kind: 'assistant',
      turnId,
      text: 'I need a few choices before preparing the comparison.',
    },
  ];
  return [
    baseSnapshot(nextSequence, transcript, {
      turn: { turnId, status: 'streaming' },
    }),
    {
      type: 'interaction.request',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      request: {
        requestId: 'ask-user-request',
        kind: 'ask-user',
        toolCallId: 'ask-user-tool',
        questions: [
          {
            index: 0,
            topic: 'Theme',
            question: 'Which themes should be compared?',
            options: ['Light', 'Dark', 'Auto'],
            multiSelect: true,
          },
          {
            index: 1,
            topic: 'Viewport',
            question: 'Which sidebar width should be the baseline?',
            options: ['320px', '400px', '480px', '760px'],
            multiSelect: false,
          },
          {
            index: 2,
            topic: 'Notes',
            question: 'What should the visual review pay special attention to?',
            options: [],
            multiSelect: false,
          },
        ],
      },
    },
  ];
}

function review(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'review-turn';
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'review-user',
      kind: 'user',
      messageId: 'message-review',
      text: 'Implement Scenario Studio without touching production behavior.',
    },
    {
      id: 'review-tool',
      kind: 'tool',
      turnId,
      toolUseId: 'review-edit',
      toolName: 'ApplyPatch',
      action: 'Updated Webview development files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
      durationMs: 1_420,
      filePath: 'src/webview-v2/dev/main.tsx',
      additionalFileCount: 3,
    },
    {
      id: 'review-assistant',
      kind: 'assistant',
      turnId,
      text: 'Scenario Studio now drives the existing production App through validated messages.',
    },
    {
      id: 'review-changes',
      kind: 'changes',
      turnId,
      files: [
        {
          path: 'src/webview-v2/dev/main.tsx',
          additions: 82,
          deletions: 214,
        },
        {
          path: 'src/webview-v2/dev/scenarios.ts',
          additions: 386,
          deletions: 0,
        },
        {
          path: 'src/webview-v2/dev/studioRuntime.ts',
          additions: 170,
          deletions: 0,
        },
        {
          path: 'src/webview-v2/dev/panelPreview.ts',
          additions: 118,
          deletions: 0,
        },
      ],
    },
  ];
  return [baseSnapshot(nextSequence, transcript)];
}

function subagent(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'subagent-turn';
  return [
    baseSnapshot(
      nextSequence,
      [
        {
          id: 'subagent-user',
          kind: 'user',
          messageId: 'message-subagent',
          text: 'Delegate a focused read-only UI inventory.',
        },
        {
          id: 'subagent-task',
          kind: 'tool',
          turnId,
          toolUseId: 'subagent-task-tool',
          toolName: 'Task',
          action: 'Delegated UI inventory',
          status: 'running',
          progressCount: 2,
          latestUpdateKind: 'status',
          subagent: {
            type: 'explorer',
            description: 'Inventory current chat surfaces',
            status: 'running',
            toolUseCount: 4,
            durationMs: 18_200,
          },
        },
      ],
      { turn: { turnId, status: 'streaming' } },
    ),
    {
      type: 'subagent.activity',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      toolUseId: 'subagent-task-tool',
      activities: [
        { action: 'Reading', target: 'src/webview-v2/chat/Transcript.tsx' },
        { action: 'Inspecting', target: 'assistant styles' },
        { action: 'Comparing', target: 'narrow and wide layouts' },
      ],
    },
  ];
}

function longHistory(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const transcript: SessionTranscriptItem[] = Array.from(
    { length: 90 },
    (_, index): SessionTranscriptItem[] => [
      {
        id: `long-user-${index}`,
        kind: 'user',
        messageId: `long-message-${index}`,
        text: `Question ${index + 1}: explain the relevant implementation detail.`,
      },
      {
        id: `long-assistant-${index}`,
        kind: 'assistant',
        turnId: `long-turn-${index}`,
        text: [
          `Answer ${index + 1}`,
          '',
          'This is retained history used to verify virtualization, sticky prompts, and the question navigator.',
          'The content is deliberately long enough to create realistic reading rhythm in a narrow sidebar.',
        ].join('\n'),
      },
    ],
  ).flat();
  return [baseSnapshot(nextSequence, transcript)];
}

function failure(nextSequence: StudioSequence): readonly HostToWebviewMessage[] {
  const turnId = 'failure-turn';
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'failure-history-notice',
      kind: 'diagnostic',
      turnId: null,
      severity: 'warning',
      code: 'history-partial',
      message: 'Older unsupported events were omitted from this transcript.',
    },
    {
      id: 'failure-user',
      kind: 'user',
      messageId: 'message-failure',
      text: 'Run the focused validation.',
    },
  ];
  return [
    baseSnapshot(nextSequence, transcript, {
      turn: { turnId, status: 'streaming' },
      historyStatus: 'partial',
      truncated: true,
    }),
    {
      type: 'tool.activity',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      toolUseId: 'failure-command',
      toolName: 'Execute',
      action: 'Ran the focused tests',
      status: 'failed',
      progressCount: 1,
      latestUpdateKind: 'error',
      durationMs: 2_480,
      detailKind: 'command',
      detail: 'pnpm exec vitest run src/webview-v2/host/hostMessageSource.test.ts',
      errorMessage: 'TypeError: expected the active scenario to be reset.',
      outputTail: 'FAIL src/webview-v2/host/hostMessageSource.test.ts\n1 test failed\n',
    },
    {
      type: 'turn.error',
      sequence: nextSequence(),
      sessionId: SESSION_ID,
      turnId,
      code: 'turn-failed',
      message: 'The focused validation failed. Review the command output and retry.',
      retryable: true,
    },
    {
      type: 'host.connection',
      sequence: nextSequence(),
      conversationId: SESSION_ID,
      sessionId: SESSION_ID,
      connection: {
        status: 'unavailable',
        message: 'The local Droid connection closed unexpectedly.',
      },
    },
  ];
}

export const STUDIO_SCENARIOS: readonly StudioScenario[] = [
  ...createAcceptanceScenarios(baseSnapshot, SESSION_ID),
  {
    id: 'chat-region',
    label: 'Chat region',
    description: 'Controlled Markdown, inline activity, terminal and operation Diff comparison',
    build: (nextSequence) => [baseSnapshot(nextSequence, chatRegionTranscript())],
  },
  {
    id: 'conversation',
    label: 'Conversation',
    description: 'Messages, Markdown, actions, and Composer',
    build: conversation,
  },
  {
    id: 'streaming',
    label: 'Streaming',
    description: 'Thinking, tools, command output, and pending response',
    build: streaming,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Live Todo plan and ExitSpecMode approval',
    build: plan,
  },
  {
    id: 'ask-user',
    label: 'AskUser',
    description: 'Single, multi-select, and open-response questions',
    build: askUser,
  },
  {
    id: 'ask-user-result',
    label: 'Answers',
    description: 'Complete questions and answers with role labels',
    build: (nextSequence) => [
      baseSnapshot(nextSequence, [
        {
          id: 'answers-prompt',
          kind: 'user',
          messageId: 'message-answers',
          text: '请确认这次界面检查的范围。',
        },
        {
          id: 'answers-result',
          kind: 'ask-user-result',
          turnId: 'answers-turn',
          status: 'answered',
          answers: [
            {
              topic: '修改范围',
              question:
                '这次是否只调整问答记录的边框、角色标注和上下排版，并保留现有的提问与回答流程？',
              answer: '按这个范围实施。',
            },
            {
              topic: '验收方式',
              question:
                '你希望在哪些主题和侧栏宽度下检查效果？\n请特别说明长问题是否需要完整显示。',
              answer:
                '检查浅色和深色主题，以及 320px 和 480px 侧栏。\n问题和回答都完整显示，不要摘要。',
            },
          ],
        },
      ]),
    ],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Changes history and ReviewDock',
    build: review,
  },
  {
    id: 'subagent',
    label: 'Subagent',
    description: 'Delegation card, activity, and running state',
    build: subagent,
  },
  {
    id: 'long-history',
    label: 'Long history',
    description: 'Virtualization, sticky prompts, and question navigation',
    build: longHistory,
  },
  {
    id: 'failure',
    label: 'Failure',
    description: 'Tool error, turn failure, partial history, and disconnect',
    build: failure,
  },
];

export function isStudioScenarioId(value: string): value is StudioScenarioId {
  return (STUDIO_SCENARIO_IDS as readonly string[]).includes(value);
}

export function getStudioScenario(id: StudioScenarioId): StudioScenario {
  return STUDIO_SCENARIOS.find((scenario) => scenario.id === id)!;
}
