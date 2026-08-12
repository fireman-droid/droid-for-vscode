// Shared internals for the src/extension/chat/ module family, split
// out of ChatController.ts (structure-only refactor; bodies moved
// verbatim). Everything here is internal to the chat directory plus
// ChatController.ts itself — nothing is a Bridge or extension API.
import type {
  AttachmentSummary,
  EditAttachmentSummary,
  HostToWebviewMessage,
  TurnStatus,
} from '../../shared/bridgeMessages';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import type { RuntimeAttachment } from '../../runtime/DroidRuntime';
import type { SessionCatalog } from '../../runtime/SessionCatalog';
import type { TurnActivityState } from '../turnActivityState';
import type { HostTranscriptProjectionMessage } from '../hostTranscriptState';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from '../SessionRecoveryStore';
import type { ChatController } from '../ChatController';

/**
 * The visible face the extracted chat/ modules operate on. The
 * controller's fields were promoted from `private` for this refactor;
 * by convention only ChatController.ts and files inside
 * src/extension/chat/ may consume this type — it is not part of the
 * extension's public API surface.
 */
export type ChatControllerInternals = ChatController;

export interface CurrentTurn {
  readonly turnId: string;
  status: TurnStatus;
  error?: string;
  activity: TurnActivityState;
  /**
   * Marks a turn synthesized by reload reconciliation: the agent loop
   * runs daemon-side with no local stream, so completion comes from
   * working-state polling and Stop must use `interruptSession()`.
   */
  readonly recovery?: true;
}

export interface PendingAttachment {
  readonly summary: AttachmentSummary;
  readonly runtime: RuntimeAttachment;
}

/**
 * One entry of the per-message edit staging area. `runtime` is null
 * for chips whose original payload is no longer available (evicted
 * from the retention area or predating this window); those can only
 * be removed, never resent.
 */
export interface EditStagedAttachment {
  readonly summary: EditAttachmentSummary;
  readonly runtime: RuntimeAttachment | null;
}

export interface EditStage {
  readonly messageId: string;
  attachments: readonly EditStagedAttachment[];
}

export interface DisposableSubscription {
  dispose(): void;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTranscriptProjection(
  message: HostToWebviewMessage,
): message is HostTranscriptProjectionMessage {
  return (
    message.type === 'assistant.delta' ||
    message.type === 'thinking.delta' ||
    message.type === 'thinking.complete' ||
    message.type === 'tool.activity' ||
    message.type === 'subagent.update' ||
    message.type === 'transcript.image' ||
    message.type === 'runtime.diagnostic' ||
    message.type === 'turn.state'
  );
}

export function isSafeBridgeId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function createEmptySessionCatalog(): SessionCatalog {
  return {
    async listSessions() {
      return { status: 'available', sessions: [] };
    },
  };
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function createTransientRecoveryStore(): SessionRecoveryStore {
  const values = new Map<string, unknown>();
  const persistence: SessionRecoveryPersistence = {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
  return new SessionRecoveryStore(persistence);
}
