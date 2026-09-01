import type {
  ChangedFileSummary,
  ImageMediaType,
  SessionTranscriptItem,
  TurnStatus,
} from '../shared/bridgeMessages';
import { randomUUID } from 'node:crypto';
import type { HostTranscriptState } from './hostTranscriptState';

export const CONVERSATION_RECOVERY_VERSION = 2;
export const LEGACY_SESSION_RECOVERY_VERSION = 1;
export const MAX_RECOVERY_CONVERSATIONS = 8;
export const MAX_CONVERSATION_NODES = 32;
export const MAX_CONVERSATION_OPERATIONS = 64;
export const MAX_CONVERSATION_TURNS = 256;

export const SESSION_LINEAGE_RELATIONS = [
  'root',
  'fork',
  'rewind',
  'compact',
  'handoff',
] as const;

export type SessionLineageRelation =
  (typeof SESSION_LINEAGE_RELATIONS)[number];

export interface ConversationDisplaySnapshot {
  readonly transcript: HostTranscriptState;
  readonly turn: {
    readonly turnId: string;
    readonly status: TurnStatus;
    readonly error?: string;
  } | null;
  readonly revision: number;
  readonly images: readonly ConversationImageArtifact[];
}

export interface ConversationImageArtifact {
  readonly itemId: string;
  readonly artifactId: string;
  readonly mediaType: ImageMediaType;
  readonly byteLength: number;
}

export interface ConversationSessionNode {
  readonly sessionId: string;
  readonly relation: SessionLineageRelation;
  readonly parentConversationId: string | null;
  readonly parentSessionId: string | null;
  readonly anchorTurnId?: string;
  readonly checkpointRevision: number;
}

export interface ConversationTurnRecord {
  readonly turnId: string;
  readonly sessionId: string;
  readonly prompt: string | null;
  readonly messageId?: string;
  readonly status: TurnStatus;
  readonly changesSettled: boolean;
  readonly files: readonly ChangedFileSummary[];
  readonly firstRevision: number;
  readonly lastRevision: number;
}

export interface ConversationOperation {
  readonly sequence: number;
  readonly kind:
    | Exclude<SessionLineageRelation, 'root'>
    | 'turn-settled';
  readonly sessionId: string;
  readonly sourceSessionId?: string;
  readonly turnId?: string;
}

export interface ConversationRecoveryRecord {
  readonly conversationId: string;
  readonly activeSessionId: string;
  readonly lastAccess: number;
  readonly display: ConversationDisplaySnapshot;
  readonly nodes: readonly ConversationSessionNode[];
  readonly turns: readonly ConversationTurnRecord[];
  readonly operations: readonly ConversationOperation[];
  readonly queuedTexts: readonly string[];
}

export function createRootConversation(
  sessionId: string,
  transcript: HostTranscriptState,
  lastAccess: number,
  queuedTexts: readonly string[] = [],
): ConversationRecoveryRecord {
  const display = createDisplaySnapshot(transcript);
  return {
    conversationId: sessionId,
    activeSessionId: sessionId,
    lastAccess,
    display,
    nodes: [
      {
        sessionId,
        relation: 'root',
        parentConversationId: null,
        parentSessionId: null,
        checkpointRevision: display.revision,
      },
    ],
    turns: deriveConversationTurns(
      sessionId,
      display.transcript.transcript,
      display.revision,
    ),
    operations: [],
    queuedTexts: [...queuedTexts],
  };
}

export function createDisplaySnapshot(
  transcript: HostTranscriptState,
  turn: ConversationDisplaySnapshot['turn'] = null,
  revision = 1,
  images: readonly ConversationImageArtifact[] = [],
): ConversationDisplaySnapshot {
  const clonedTranscript = cloneTranscriptState(transcript);
  return {
    transcript: clonedTranscript,
    turn: turn === null ? null : { ...turn },
    revision,
    images: reconcileImageArtifacts(clonedTranscript, images),
  };
}

export function writeConversationDisplay(
  conversation: ConversationRecoveryRecord,
  sessionId: string,
  transcript: HostTranscriptState,
  lastAccess: number,
  turn: ConversationDisplaySnapshot['turn'] =
    conversation.display.turn,
): ConversationRecoveryRecord | undefined {
  if (conversation.activeSessionId !== sessionId) {
    return undefined;
  }
  const display = createDisplaySnapshot(
    transcript,
    turn,
    conversation.display.revision + 1,
    conversation.display.images,
  );
  return {
    ...conversation,
    lastAccess,
    display,
    nodes: conversation.nodes.map((node) =>
      node.sessionId === sessionId
        ? { ...node, checkpointRevision: display.revision }
        : node,
    ),
    turns: mergeDerivedTurns(
      conversation.turns,
      deriveConversationTurns(
        sessionId,
        display.transcript.transcript,
        display.revision,
      ),
    ),
  };
}

export function adoptConversationSuccessor(
  conversation: ConversationRecoveryRecord,
  sourceSessionId: string,
  successorSessionId: string,
  relation: 'compact' | 'handoff',
  lastAccess: number,
  anchorTurnId?: string,
): ConversationRecoveryRecord {
  const sequence = nextOperationSequence(conversation.operations);
  const revision = conversation.display.revision;
  return {
    ...conversation,
    activeSessionId: successorSessionId,
    lastAccess,
    nodes: boundNodes([
      ...conversation.nodes.filter(
        (node) => node.sessionId !== successorSessionId,
      ),
      {
        sessionId: successorSessionId,
        relation,
        parentConversationId: conversation.conversationId,
        parentSessionId: sourceSessionId,
        ...(anchorTurnId === undefined ? {} : { anchorTurnId }),
        checkpointRevision: revision,
      },
    ]),
    operations: boundOperations([
      ...conversation.operations,
      {
        sequence,
        kind: relation,
        sessionId: successorSessionId,
        sourceSessionId,
        ...(anchorTurnId === undefined
          ? {}
          : { turnId: anchorTurnId }),
      },
    ]),
  };
}

export function forkConversation(
  source: ConversationRecoveryRecord,
  sourceSessionId: string,
  successorSessionId: string,
  relation: 'fork' | 'rewind',
  transcript: HostTranscriptState,
  lastAccess: number,
  anchorTurnId?: string,
): ConversationRecoveryRecord {
  const display = createDisplaySnapshot(transcript);
  return {
    conversationId: successorSessionId,
    activeSessionId: successorSessionId,
    lastAccess,
    display,
    nodes: [
      {
        sessionId: successorSessionId,
        relation,
        parentConversationId: source.conversationId,
        parentSessionId: sourceSessionId,
        ...(anchorTurnId === undefined ? {} : { anchorTurnId }),
        checkpointRevision: display.revision,
      },
    ],
    turns: deriveConversationTurns(
      successorSessionId,
      display.transcript.transcript,
      display.revision,
    ),
    operations: [
      {
        sequence: 1,
        kind: relation,
        sessionId: successorSessionId,
        sourceSessionId,
        ...(anchorTurnId === undefined
          ? {}
          : { turnId: anchorTurnId }),
      },
    ],
    queuedTexts: [],
  };
}

export function recordSettledTurn(
  conversation: ConversationRecoveryRecord,
  sessionId: string,
  turnId: string,
  prompt: string | null,
  files: readonly ChangedFileSummary[],
  status: TurnStatus,
  lastAccess: number,
  messageId?: string,
): ConversationRecoveryRecord | undefined {
  if (conversation.activeSessionId !== sessionId) {
    return undefined;
  }
  const existing = conversation.turns.find(
    (turn) => turn.turnId === turnId,
  );
  const revision = conversation.display.revision;
  const turn: ConversationTurnRecord = {
    turnId,
    sessionId,
    prompt,
    ...(messageId === undefined ? {} : { messageId }),
    status,
    changesSettled: true,
    files: files.map((file) => ({ ...file })),
    firstRevision: existing?.firstRevision ?? revision,
    lastRevision: revision,
  };
  return {
    ...conversation,
    lastAccess,
    turns: boundTurns([
      ...conversation.turns.filter(
        (candidate) => candidate.turnId !== turnId,
      ),
      turn,
    ]),
    operations: boundOperations([
      ...conversation.operations,
      {
        sequence: nextOperationSequence(conversation.operations),
        kind: 'turn-settled',
        sessionId,
        turnId,
      },
    ]),
  };
}

export function readLatestConversationChanges(
  conversation: ConversationRecoveryRecord,
): ConversationTurnRecord | undefined {
  for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
    const turn = conversation.turns[index];
    if (
      turn !== undefined &&
      turn.changesSettled &&
      turn.files.length > 0
    ) {
      return cloneTurn(turn);
    }
  }
  return undefined;
}

export function cloneConversation(
  conversation: ConversationRecoveryRecord,
): ConversationRecoveryRecord {
  return {
    ...conversation,
    display: createDisplaySnapshot(
      conversation.display.transcript,
      conversation.display.turn,
      conversation.display.revision,
      conversation.display.images,
    ),
    nodes: conversation.nodes.map((node) => ({ ...node })),
    turns: conversation.turns.map(cloneTurn),
    operations: conversation.operations.map((operation) => ({
      ...operation,
    })),
    queuedTexts: [...conversation.queuedTexts],
  };
}

export function cloneTranscriptState(
  state: HostTranscriptState,
): HostTranscriptState {
  return {
    transcript: state.transcript.map((item) => cloneTranscriptItem(item)),
    historyStatus: state.historyStatus,
    truncated: state.truncated,
  };
}

function deriveConversationTurns(
  sessionId: string,
  transcript: readonly SessionTranscriptItem[],
  revision: number,
): readonly ConversationTurnRecord[] {
  const turns = new Map<
    string,
    {
      prompt: string | null;
      messageId?: string;
      changesSettled: boolean;
      files: readonly ChangedFileSummary[];
    }
  >();
  let prompt: string | null = null;
  let messageId: string | undefined;
  for (const item of transcript) {
    if (item.kind === 'user') {
      prompt = item.text;
      messageId = item.messageId;
      continue;
    }
    if (item.turnId === null) {
      continue;
    }
    const existing = turns.get(item.turnId);
    if (item.kind === 'changes') {
      turns.set(item.turnId, {
        prompt: existing?.prompt ?? prompt,
        ...(existing?.messageId ?? messageId) === undefined
          ? {}
          : { messageId: existing?.messageId ?? messageId },
        changesSettled: true,
        files: item.files.map((file) => ({ ...file })),
      });
      continue;
    }
    if (existing === undefined) {
      turns.set(item.turnId, {
        prompt,
        ...(messageId === undefined ? {} : { messageId }),
        changesSettled: false,
        files: [],
      });
    }
  }
  return [...turns.entries()]
    .slice(-MAX_CONVERSATION_TURNS)
    .map(([turnId, turn]) => ({
      turnId,
      sessionId,
      prompt: turn.prompt,
      ...(turn.messageId === undefined
        ? {}
        : { messageId: turn.messageId }),
      status: 'completed',
      changesSettled: turn.changesSettled,
      files: turn.files,
      firstRevision: revision,
      lastRevision: revision,
    }));
}

function mergeDerivedTurns(
  existing: readonly ConversationTurnRecord[],
  derived: readonly ConversationTurnRecord[],
): readonly ConversationTurnRecord[] {
  const turns = new Map(
    existing.map((turn) => [turn.turnId, cloneTurn(turn)] as const),
  );
  for (const turn of derived) {
    const previous = turns.get(turn.turnId);
    turns.set(
      turn.turnId,
      previous === undefined
        ? turn
        : {
            ...turn,
            status: previous.status,
            changesSettled:
              turn.changesSettled || previous.changesSettled,
            files:
              turn.files.length > 0 ? turn.files : previous.files,
            firstRevision: previous.firstRevision,
          },
    );
  }
  return boundTurns([...turns.values()]);
}

function cloneTurn(
  turn: ConversationTurnRecord,
): ConversationTurnRecord {
  return {
    ...turn,
    files: turn.files.map((file) => ({ ...file })),
  };
}

function reconcileImageArtifacts(
  transcript: HostTranscriptState,
  existing: readonly ConversationImageArtifact[],
): readonly ConversationImageArtifact[] {
  const previous = new Map(
    existing.map((image) => [image.itemId, image] as const),
  );
  return transcript.transcript.flatMap((item) => {
    if (item.kind !== 'image') {
      return [];
    }
    const retained = previous.get(item.id);
    if (
      retained !== undefined &&
      retained.mediaType === item.mediaType &&
      retained.byteLength === item.byteLength
    ) {
      return [{ ...retained }];
    }
    return item.data.length === 0
      ? []
      : [
          {
            itemId: item.id,
            artifactId: randomUUID(),
            mediaType: item.mediaType,
            byteLength: item.byteLength,
          },
        ];
  });
}

function cloneTranscriptItem(
  item: SessionTranscriptItem,
): SessionTranscriptItem {
  switch (item.kind) {
    case 'user':
      return {
        ...item,
        ...(item.attachments === undefined
          ? {}
          : {
              attachments: item.attachments.map((attachment) => ({
                ...attachment,
              })),
            }),
      };
    case 'changes':
      return {
        ...item,
        files: item.files.map((file) => ({ ...file })),
      };
    case 'ask-user-result':
      return item.status === 'answered'
        ? {
            ...item,
            answers: item.answers.map((answer) => ({ ...answer })),
          }
        : { ...item };
    case 'tool':
      return {
        ...item,
        ...(item.subagent === undefined
          ? {}
          : { subagent: { ...item.subagent } }),
      };
    default:
      return { ...item };
  }
}

function nextOperationSequence(
  operations: readonly ConversationOperation[],
): number {
  return (operations.at(-1)?.sequence ?? 0) + 1;
}

function boundNodes(
  nodes: readonly ConversationSessionNode[],
): readonly ConversationSessionNode[] {
  return nodes.slice(-MAX_CONVERSATION_NODES);
}

function boundTurns(
  turns: readonly ConversationTurnRecord[],
): readonly ConversationTurnRecord[] {
  return turns.slice(-MAX_CONVERSATION_TURNS);
}

function boundOperations(
  operations: readonly ConversationOperation[],
): readonly ConversationOperation[] {
  return operations.slice(-MAX_CONVERSATION_OPERATIONS);
}
