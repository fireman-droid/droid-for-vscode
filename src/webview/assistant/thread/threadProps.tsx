import type { ReactNode } from 'react';
import { type ImageMediaType } from '../../../shared/protocol/attachments';
import { type SessionHistoryStatus } from '../../../shared/protocol/sessions';
import type { ThreadComposerProps } from '../composer/composerTypes';
import type {
  EditResendRejection,
  EditStageState,
  RewindFileInfo,
} from '../editing/editTypes';
import type { InlineHtmlPreviewHandler } from '../markdown/MarkdownText';
import type { TransientDiagnostic } from '../shell/transientNotice';
import type { PlanAnchorState } from '../transcript/planAnchor';

export interface ThreadTranscriptProps {
  readonly pending: boolean;
  readonly activity?: 'working' | 'responding';
  /** True while a transcript activity row is live (see PendingResponse). */
  readonly activityLive: boolean;
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
  readonly hiddenMessageCount: number;
  readonly onShowEarlier: () => void;
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  /** Current foreground turn; scopes Plan live styling to its own updates. */
  readonly activeTurnId: string | null;
  readonly stopping: boolean;
  readonly interactionPending: boolean;
  readonly onRetry: () => void;
  /**
   * Plan lines keyed by the id of the user message that triggered
   * the turn each plan was created in (projected in App from
   * transcript todowrites; the key doubles as the aui message id).
   * Each user anchor owns at most one thin line directly under its
   * message — the first element of that turn's reply area — updated
   * in place by later todowrites.
   */
  readonly planAnchors?: ReadonlyMap<string, PlanAnchorState> | null;
}

export interface ThreadMessageActions {
  /** Switches to another session (compact divider history jump). */
  readonly onSelectSession: (sessionId: string) => void;
  readonly onBtwQuote?: (quote: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly editStage: EditStageState | null;
  readonly editResendRejection: EditResendRejection | null;
  /**
   * Committed-Composer-send counter. Each change closes any open
   * user-message edit card: sending a new message is an explicit
   * signal the user abandoned that edit, so its draft is discarded.
   */
  readonly sendSignal: number;
  readonly onEditStageBegin: (messageId: string) => void;
  readonly onEditStageCancel: () => void;
  readonly onEditAttachFiles: () => void;
  readonly onEditAttachEditor: () => void;
  readonly onEditAttachSelection: () => void;
  readonly onEditAttachProblems: () => void;
  readonly onEditAttachGitChanges: () => void;
  readonly onEditAttachImage: (
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onEditAttachPdf: (name: string, dataBase64: string) => void;
  readonly onEditAttachRemoteImage: (url: string) => void;
  readonly onEditAttachUris: (uris: readonly string[]) => void;
  readonly onEditAttachTextFile: (name: string, text: string, truncated: boolean) => void;
  readonly onEditAttachmentRemove: (attachmentId: string) => void;
  readonly onRegenerate: (() => void) | null;
  /** Forks a new session from the current state (last message only). */
  readonly onForkSession: (() => void) | null;
  readonly onOpenFileDiff: (path: string, turnId: string | null) => void;
  readonly onOpenReviewTurn: (turnId: string) => void;
  readonly onPreviewFile: (path: string) => void;
  /** Renders an assistant HTML code block in the sandbox panel. */
  readonly onPreviewInlineHtml: InlineHtmlPreviewHandler;
  /**
   * Absolute workspace folder from the host snapshot; rebases absolute
   * transcript path links for the Preview entry. Null hides the entry.
   */
  readonly workspaceRoot: string | null;
  /** Reveals the read-only terminal mirror of execute output. */
  readonly onOpenTerminalMirror: () => void;
  readonly editResendEnabled: boolean;
}

export interface ThreadSlots {
  readonly inlineInteraction?: ReactNode;
  readonly footerInteraction?: ReactNode;
  /**
   * The queued-prompts bar stacked directly above the Composer in
   * the viewport footer; null while the queue is empty. Built in App
   * so the thread stays free of queue state.
   */
  readonly queuedMessages?: ReactNode;
  /** Inline Mission setup, mounted directly above the existing Composer. */
  readonly missionSetup?: ReactNode;
  /**
   * Latest turn's Changes review, pinned above queued prompts and the
   * Composer. Built in App because the footer's transcript contexts
   * have already closed at this boundary.
   */
  readonly reviewDock?: ReactNode;
  /** Short-lived host feedback rendered outside assistant-ui history. */
  readonly transientDiagnostic?: TransientDiagnostic | null;
}

export interface DroidThreadProps {
  readonly transcript: ThreadTranscriptProps;
  readonly composer: ThreadComposerProps;
  readonly messageActions: ThreadMessageActions;
  readonly slots: ThreadSlots;
}

export type {
  FileSearchResult,
  SlashCommandsState,
  ThreadComposerProps,
} from '../composer/composerTypes';
export type {
  EditResendRejection,
  EditStageState,
  RewindFileInfo,
} from '../editing/editTypes';
