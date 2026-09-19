import {
  type AskUserInteractionResult,
  type PermissionConfirmationKind,
} from './interactionProtocol';

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

export type InteractionRequest = PermissionInteractionRequest | AskUserInteractionRequest;

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
  readonly result?: AskUserInteractionResult;
}
