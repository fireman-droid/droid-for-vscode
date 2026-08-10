import {
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  type PermissionConfirmationKind,
} from './interactionProtocol';

export {
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
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
  PERMISSION_CONFIRMATION_KINDS,
  type PermissionConfirmationKind,
} from './interactionProtocol';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const MAX_TURN_TEXT_LENGTH = 200_000;
export const MAX_ASSISTANT_TEXT_LENGTH = 200_000;
export const MAX_THINKING_TEXT_LENGTH = 32_000;
export const MAX_TOOL_NAME_LENGTH = MAX_PERMISSION_TOOL_NAME_LENGTH;
export const MAX_TOOL_ACTIVITIES_PER_TURN = 100;
export const MAX_INTERACTION_TEXT_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_SESSION_CATALOG_ITEMS = 50;
export const MAX_SESSION_TRANSCRIPT_ITEMS = 200;
export const MAX_SESSION_TITLE_LENGTH = 256;

export const CONNECTION_STATUSES = [
  'idle',
  'connecting',
  'connected',
  'unavailable',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const TURN_STATUSES = [
  'idle',
  'submitting',
  'streaming',
  'stopping',
  'completed',
  'interrupted',
  'failed',
] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export const TOOL_ACTIVITY_STATUSES = [
  'running',
  'completed',
  'failed',
] as const;
export type ToolActivityStatus =
  (typeof TOOL_ACTIVITY_STATUSES)[number];

export const DIAGNOSTIC_SEVERITIES = [
  'info',
  'warning',
  'error',
] as const;
export type DiagnosticSeverity =
  (typeof DIAGNOSTIC_SEVERITIES)[number];

export const SESSION_CATALOG_STATUSES = [
  'idle',
  'loading',
  'ready',
  'error',
] as const;
export type SessionCatalogStatus =
  (typeof SESSION_CATALOG_STATUSES)[number];

export const SESSION_HISTORY_STATUSES = [
  'complete',
  'partial',
  'unavailable',
] as const;
export type SessionHistoryStatus =
  (typeof SESSION_HISTORY_STATUSES)[number];

export const TRANSCRIPT_THINKING_STATUSES = [
  'active',
  'complete',
  'stopping',
  'stopped',
] as const;
export type TranscriptThinkingStatus =
  (typeof TRANSCRIPT_THINKING_STATUSES)[number];

export const TRANSCRIPT_TOOL_STATUSES = [
  ...TOOL_ACTIVITY_STATUSES,
  'stopping',
  'stopped',
] as const;
export type TranscriptToolStatus =
  (typeof TRANSCRIPT_TOOL_STATUSES)[number];

export interface WebviewReadyMessage {
  readonly type: 'webview.ready';
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
}

export interface TurnSendMessage {
  readonly type: 'turn.send';
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
}

export interface TurnStopMessage {
  readonly type: 'turn.stop';
  readonly sessionId: string;
  readonly turnId: string;
}

export interface RuntimeRetryMessage {
  readonly type: 'runtime.retry';
  readonly sessionId: string | null;
}

export interface PermissionRespondMessage {
  readonly type: 'permission.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly selectedOption: string;
  readonly editedSpecContent?: string;
}

export interface AskUserAnswer {
  readonly index: number;
  readonly answer: string;
}

export interface AskUserRespondMessage {
  readonly type: 'ask-user.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly cancelled: boolean;
  readonly answers: readonly AskUserAnswer[];
}

export interface SessionsRefreshMessage {
  readonly type: 'sessions.refresh';
}

export interface SessionSelectMessage {
  readonly type: 'session.select';
  readonly sessionId: string;
}

export interface SessionNewMessage {
  readonly type: 'session.new';
}

export type WebviewToHostMessage =
  | WebviewReadyMessage
  | TurnSendMessage
  | TurnStopMessage
  | RuntimeRetryMessage
  | PermissionRespondMessage
  | AskUserRespondMessage
  | SessionsRefreshMessage
  | SessionSelectMessage
  | SessionNewMessage;

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly message?: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly modifiedTime: string;
  readonly active: boolean;
}

export interface SessionCatalogState {
  readonly status: SessionCatalogStatus;
  readonly items: readonly SessionSummary[];
  readonly message?: string;
}

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
}

export interface AssistantTranscriptItem {
  readonly id: string;
  readonly kind: 'assistant';
  readonly turnId: string;
  readonly text: string;
}

export interface ThinkingTranscriptItem {
  readonly id: string;
  readonly kind: 'thinking';
  readonly turnId: string;
  readonly text: string;
  readonly status: TranscriptThinkingStatus;
  readonly durationMs?: number;
  readonly truncated: boolean;
}

export interface ToolTranscriptItem {
  readonly id: string;
  readonly kind: 'tool';
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly status: TranscriptToolStatus;
}

export interface DiagnosticTranscriptItem {
  readonly id: string;
  readonly kind: 'diagnostic';
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
}

export type SessionTranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ThinkingTranscriptItem
  | ToolTranscriptItem
  | DiagnosticTranscriptItem;

export interface HostSnapshotMessage {
  readonly type: 'host.snapshot';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
  readonly turn: {
    readonly turnId: string;
    readonly status: TurnStatus;
    readonly error?: string;
  } | null;
  readonly sessions: SessionCatalogState;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: SessionHistoryStatus;
  readonly truncated: boolean;
}

export interface HostConnectionMessage {
  readonly type: 'host.connection';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
}

export interface AssistantDeltaMessage {
  readonly type: 'assistant.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
}

export interface ThinkingDeltaMessage {
  readonly type: 'thinking.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
  readonly truncated: boolean;
}

export interface ThinkingCompleteMessage {
  readonly type: 'thinking.complete';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly durationMs: number | null;
}

export interface ToolActivityMessage {
  readonly type: 'tool.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly status: ToolActivityStatus;
}

export interface RuntimeDiagnosticMessage {
  readonly type: 'runtime.diagnostic';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
}

export interface TurnStateMessage {
  readonly type: 'turn.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
}

export interface TurnErrorMessage {
  readonly type: 'turn.error';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface PermissionToolSummary {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly confirmationKind: PermissionConfirmationKind;
  readonly title: string;
  readonly detail?: string;
  readonly riskNote?: string;
}

export interface PermissionOption {
  readonly label: string;
  readonly value: string;
  readonly requiresEditedSpec: boolean;
}

export interface PermissionInteractionRequest {
  readonly requestId: string;
  readonly kind: 'permission';
  readonly tools: readonly PermissionToolSummary[];
  readonly options: readonly PermissionOption[];
  readonly editableSpecContent?: string;
}

export interface AskUserQuestion {
  readonly index: number;
  readonly topic: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

export interface AskUserInteractionRequest {
  readonly requestId: string;
  readonly kind: 'ask-user';
  readonly toolCallId: string;
  readonly questions: readonly AskUserQuestion[];
}

export type InteractionRequest =
  | PermissionInteractionRequest
  | AskUserInteractionRequest;

export interface InteractionRequestMessage {
  readonly type: 'interaction.request';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly request: InteractionRequest;
}

export interface InteractionClosedMessage {
  readonly type: 'interaction.closed';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
}

export type HostToWebviewMessage =
  | HostSnapshotMessage
  | HostConnectionMessage
  | AssistantDeltaMessage
  | ThinkingDeltaMessage
  | ThinkingCompleteMessage
  | ToolActivityMessage
  | RuntimeDiagnosticMessage
  | TurnStateMessage
  | TurnErrorMessage
  | InteractionRequestMessage
  | InteractionClosedMessage;
