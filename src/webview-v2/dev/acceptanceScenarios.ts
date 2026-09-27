import { type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { StudioScenario, StudioSequence } from './scenarios';

type SnapshotMessage = Extract<HostToWebviewMessage, { type: 'host.snapshot' }>;

export type StudioSnapshotBuilder = (
  nextSequence: StudioSequence,
  transcript: readonly SessionTranscriptItem[],
  options?: {
    readonly turn?: SnapshotMessage['turn'];
    readonly historyStatus?: SnapshotMessage['historyStatus'];
    readonly truncated?: boolean;
    readonly connection?: SnapshotMessage['connection'];
  },
) => SnapshotMessage;

export function createAcceptanceScenarios(
  snapshot: StudioSnapshotBuilder,
  sessionId: string,
): readonly StudioScenario[] {
  return [
    {
      id: 'full-workflow',
      label: 'Full workflow',
      description: 'Dense end-to-end work with tools, Plan, Subagent, Changes, and queue',
      build: (nextSequence) => fullWorkflow(snapshot, sessionId, nextSequence),
    },
    {
      id: 'permission',
      label: 'Permission',
      description: 'Multi-tool confirmation with risk and approval options',
      build: (nextSequence) => permission(snapshot, sessionId, nextSequence),
    },
    {
      id: 'queued-attachments',
      label: 'Queue + files',
      description: 'Paused queued prompts and staged attachment chips',
      build: (nextSequence) => queuedAttachments(snapshot, sessionId, nextSequence),
    },
    {
      id: 'empty',
      label: 'Empty',
      description: 'Connected session before the first message',
      build: (nextSequence) => [snapshot(nextSequence, [])],
    },
  ];
}

function fullWorkflow(
  snapshot: StudioSnapshotBuilder,
  sessionId: string,
  nextSequence: StudioSequence,
): readonly HostToWebviewMessage[] {
  const activeTurnId = 'workflow-turn-active';
  const transcript: SessionTranscriptItem[] = [
    {
      id: 'workflow-user-architecture',
      kind: 'user',
      messageId: 'workflow-message-architecture',
      text: 'Inspect the chat architecture before changing the Scenario Studio.',
      attachments: [
        { kind: 'text', name: 'ui-notes.md', sizeBytes: 8_420 },
        { kind: 'selection', name: 'Thread.tsx selection', sizeBytes: 2_180 },
      ],
    },
    {
      id: 'workflow-thinking-architecture',
      kind: 'thinking',
      turnId: 'workflow-turn-architecture',
      text: 'I need to trace the production App, bridge validator, reducer, and the existing development transport.',
      status: 'complete',
      durationMs: 4_820,
      truncated: false,
    },
    {
      id: 'workflow-read',
      kind: 'tool',
      turnId: 'workflow-turn-architecture',
      toolUseId: 'workflow-read-tool',
      toolName: 'Read',
      action: 'Read production Webview files',
      status: 'completed',
      progressCount: 3,
      latestUpdateKind: 'tool-result',
      durationMs: 1_120,
      filePath: 'src/webview-v2/chat/ChatApp.tsx',
      additionalFileCount: 2,
      target: 'App.tsx · store.ts · vscode.ts',
    },
    {
      id: 'workflow-grep',
      kind: 'tool',
      turnId: 'workflow-turn-architecture',
      toolUseId: 'workflow-grep-tool',
      toolName: 'Grep',
      action: 'Searched Bridge message consumers',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
      durationMs: 688,
      target: 'interaction.request · src/webview',
    },
    {
      id: 'workflow-architecture-answer',
      kind: 'assistant',
      turnId: 'workflow-turn-architecture',
      text: [
        'The production boundary is suitable for deterministic UI fixtures.',
        '',
        '### Constraints',
        '',
        '1. Keep `ChatController` as the runtime authority.',
        '2. Feed fixtures through `readHostMessage` and the production reducer.',
        '3. Reset Webview-local state between scenarios.',
        '',
        '```ts',
        'runtime.postMessage({',
        "  type: 'webview.ready',",
        '  protocolVersion: BRIDGE_PROTOCOL_VERSION,',
        '});',
        '```',
      ].join('\n'),
    },
    {
      id: 'workflow-user-implementation',
      kind: 'user',
      messageId: 'workflow-message-implementation',
      text: 'Implement the full acceptance workspace and validate it.',
    },
    {
      id: 'workflow-plan',
      kind: 'tool',
      turnId: activeTurnId,
      toolUseId: 'workflow-plan-tool',
      toolName: 'TodoWrite',
      action: 'Updated the implementation plan',
      status: 'running',
      progressCount: 2,
      latestUpdateKind: 'status',
      detailKind: 'plan',
      detail: [
        '1. [completed] Inventory production UI states',
        '2. [completed] Build the complete workflow transcript',
        '3. [in_progress] Add dedicated permission and queue states',
        '4. [pending] Validate all fixtures through the Bridge',
      ].join('\n'),
    },
    {
      id: 'workflow-apply-patch',
      kind: 'tool',
      turnId: activeTurnId,
      toolUseId: 'workflow-patch-tool',
      toolName: 'ApplyPatch',
      action: 'Updated Scenario Studio fixtures',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'tool-result',
      durationMs: 1_940,
      filePath: 'src/webview-v2/dev/acceptanceScenarios.ts',
      additionalFileCount: 2,
    },
    {
      id: 'workflow-execute',
      kind: 'tool',
      turnId: activeTurnId,
      toolUseId: 'workflow-execute-tool',
      toolName: 'Execute',
      action: 'Ran TypeScript checks',
      status: 'completed',
      progressCount: 2,
      latestUpdateKind: 'tool-result',
      durationMs: 3_280,
      detailKind: 'command',
      detail: 'pnpm run typecheck',
      outputTail: [
        'typecheck:extension passed',
        'typecheck:webview passed',
        'No type errors found',
      ].join('\n'),
    },
    {
      id: 'workflow-subagent',
      kind: 'tool',
      turnId: activeTurnId,
      toolUseId: 'workflow-subagent-tool',
      toolName: 'Task',
      action: 'Delegated responsive-state inventory',
      status: 'running',
      progressCount: 3,
      latestUpdateKind: 'status',
      subagent: {
        type: 'explorer',
        description: 'Check narrow chat states and activity hierarchy',
        status: 'running',
        toolUseCount: 6,
        durationMs: 26_400,
      },
    },
    {
      id: 'workflow-changes',
      kind: 'changes',
      turnId: activeTurnId,
      files: [
        {
          path: 'src/webview-v2/dev/acceptanceScenarios.ts',
          additions: 318,
          deletions: 0,
        },
        {
          path: 'src/webview-v2/dev/scenarios.ts',
          additions: 18,
          deletions: 2,
        },
        {
          path: 'src/webview-v2/dev/studioRuntime.ts',
          additions: 12,
          deletions: 4,
        },
      ],
    },
    {
      id: 'workflow-answer-draft',
      kind: 'assistant',
      turnId: activeTurnId,
      text: 'The complete workflow is assembled. I am waiting for the delegated responsive-state inventory before finalizing.',
    },
  ];
  const initial = snapshot(nextSequence, transcript, {
    turn: { turnId: activeTurnId, status: 'streaming' },
  });
  return [
    {
      ...initial,
      queue: {
        items: [
          {
            queueId: 'workflow-queue-one',
            text: 'After validation, summarize every state now available.',
            attachments: [],
          },
          {
            queueId: 'workflow-queue-two',
            text: 'Then compare the 320px and 480px layouts.',
            attachments: [{ kind: 'image', name: 'reference.png', sizeBytes: 148_220 }],
          },
        ],
        paused: null,
      },
    },
    {
      type: 'subagent.activity',
      sequence: nextSequence(),
      sessionId,
      turnId: activeTurnId,
      toolUseId: 'workflow-subagent-tool',
      activities: [
        { action: 'Reviewing', target: '320px Composer layout' },
        { action: 'Checking', target: 'Plan and ReviewDock stacking' },
        { action: 'Inspecting', target: 'Subagent activity density' },
        { action: 'Comparing', target: 'Light and Dark contrast' },
      ],
    },
  ];
}

function permission(
  snapshot: StudioSnapshotBuilder,
  sessionId: string,
  nextSequence: StudioSequence,
): readonly HostToWebviewMessage[] {
  const turnId = 'permission-turn';
  return [
    snapshot(
      nextSequence,
      [
        {
          id: 'permission-user',
          kind: 'user',
          messageId: 'permission-message',
          text: 'Update the local fixture and run the focused validation.',
        },
        {
          id: 'permission-thinking',
          kind: 'thinking',
          turnId,
          text: 'The requested work needs a source edit and a local command.',
          status: 'complete',
          durationMs: 2_240,
          truncated: false,
        },
      ],
      { turn: { turnId, status: 'streaming' } },
    ),
    {
      type: 'interaction.request',
      sequence: nextSequence(),
      sessionId,
      turnId,
      request: {
        requestId: 'permission-request',
        kind: 'permission',
        tools: [
          {
            toolUseId: 'permission-edit',
            toolName: 'ApplyPatch',
            confirmationKind: 'apply_patch',
            title: 'Update Scenario Studio fixtures',
            detail: 'src/webview-v2/dev/acceptanceScenarios.ts',
          },
          {
            toolUseId: 'permission-execute',
            toolName: 'Execute',
            confirmationKind: 'exec',
            title: 'Run TypeScript checks',
            detail: 'pnpm run typecheck',
            riskNote: 'May create transient compiler cache data.',
          },
        ],
        options: [
          {
            label: 'Deny',
            value: 'deny',
            requiresEditedSpec: false,
          },
          {
            label: 'Allow once',
            value: 'proceed_once',
            requiresEditedSpec: false,
          },
          {
            label: 'Allow safe commands',
            value: 'proceed_safe',
            requiresEditedSpec: false,
          },
        ],
      },
    },
  ];
}

function queuedAttachments(
  snapshot: StudioSnapshotBuilder,
  sessionId: string,
  nextSequence: StudioSequence,
): readonly HostToWebviewMessage[] {
  const initial = snapshot(nextSequence, [
    {
      id: 'queue-user',
      kind: 'user',
      messageId: 'queue-message',
      text: 'Apply the UI changes and run validation.',
    },
    {
      id: 'queue-command',
      kind: 'tool',
      turnId: 'queue-failed-turn',
      toolUseId: 'queue-command-tool',
      toolName: 'Execute',
      action: 'Ran focused validation',
      status: 'failed',
      progressCount: 1,
      latestUpdateKind: 'error',
      detailKind: 'command',
      detail: 'pnpm exec tsc -p src/webview-v2/tsconfig.json --noEmit',
      errorMessage: 'The typecheck stopped before queued prompts could run.',
      outputTail: 'Found 1 error in src/webview-v2/dev/scenarios.ts\n',
    },
    {
      id: 'queue-diagnostic',
      kind: 'diagnostic',
      turnId: 'queue-failed-turn',
      severity: 'warning',
      code: 'queue-paused',
      message: 'Queued prompts are paused after the failed turn.',
    },
  ]);
  return [
    {
      ...initial,
      queue: {
        items: [
          {
            queueId: 'queue-fix-types',
            text: 'Fix the type error, then run the same validation again.',
            attachments: [],
          },
          {
            queueId: 'queue-review-screenshot',
            text: 'Compare the result against these acceptance references.',
            attachments: [
              { kind: 'image', name: 'dark-480.png', sizeBytes: 182_400 },
              { kind: 'image', name: 'light-320.png', sizeBytes: 164_810 },
            ],
          },
          {
            queueId: 'queue-summary',
            text: 'Summarize the final visual differences.',
            attachments: [{ kind: 'text', name: 'review-notes.md', sizeBytes: 6_420 }],
          },
        ],
        paused: 'turn-failed',
      },
    },
    {
      type: 'session.attachments',
      sequence: nextSequence(),
      sessionId,
      attachments: [
        {
          id: 'staged-image',
          kind: 'image',
          name: 'composer-reference.png',
          sizeBytes: 224_180,
          truncated: false,
        },
        {
          id: 'staged-pdf',
          kind: 'pdf',
          name: 'design-review.pdf',
          sizeBytes: 1_842_220,
          truncated: false,
        },
        {
          id: 'staged-selection',
          kind: 'selection',
          name: 'Current editor selection',
          sizeBytes: 3_280,
          truncated: true,
        },
      ],
    },
  ];
}
