import { type SessionTranscriptItem } from './transcript';
import { type ThemePreference } from './shell';

export const SESSION_VIEWER_PROTOCOL_VERSION = 3 as const;
export const MAX_SESSION_VIEWER_TITLE_LENGTH = 512;
export const MAX_SESSION_VIEWER_REASON_LENGTH = 512;
export const SESSION_VIEWER_TARGET_KINDS = ['daemon-session'] as const;
export type SessionViewerTargetKind = (typeof SESSION_VIEWER_TARGET_KINDS)[number];
export type SessionViewerMode = 'standard' | 'mission-readonly' | 'subagent-readonly';

export type SessionViewerTarget =
  | {
      readonly kind: SessionViewerTargetKind;
      readonly mode: 'standard';
      readonly sessionId: string;
      readonly title: string;
    }
  | {
      readonly kind: SessionViewerTargetKind;
      readonly mode: 'mission-readonly' | 'subagent-readonly';
      readonly title: string;
    };

export type SessionViewerStopOutcome = 'accepted' | 'not-running' | 'failed';
export type SessionViewerLifecycle =
  | 'starting'
  | 'working'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SessionViewerWebviewMessage =
  | {
      readonly type: 'sessionViewer.ready';
      readonly protocolVersion: typeof SESSION_VIEWER_PROTOCOL_VERSION;
    }
  | {
      readonly type: 'sessionViewer.stop';
      readonly protocolVersion: typeof SESSION_VIEWER_PROTOCOL_VERSION;
    }
  | {
      readonly type: 'webview.diagnostic';
      readonly kind: string;
      readonly detail: string;
    };

export type SessionViewerSnapshotMessage =
  | {
      readonly type: 'sessionViewer.snapshot';
      readonly protocolVersion: typeof SESSION_VIEWER_PROTOCOL_VERSION;
      readonly status: 'ready';
      readonly target: SessionViewerTarget;
      readonly items: readonly SessionTranscriptItem[];
      readonly truncated: boolean;
      readonly running: boolean;
      readonly lifecycle: SessionViewerLifecycle;
      readonly stopping: boolean;
      readonly stopError: boolean;
    }
  | {
      readonly type: 'sessionViewer.snapshot';
      readonly protocolVersion: typeof SESSION_VIEWER_PROTOCOL_VERSION;
      readonly status: 'unavailable';
      readonly target: SessionViewerTarget;
      readonly reason: string;
      readonly running: boolean;
      readonly lifecycle: SessionViewerLifecycle;
      readonly stopping: boolean;
      readonly stopError: boolean;
    };

export interface SessionViewerThemeMessage {
  readonly type: 'sessionViewer.theme';
  readonly preference: ThemePreference;
  readonly resolved: 'light' | 'dark';
}

export type SessionViewerHostMessage =
  | SessionViewerSnapshotMessage
  | SessionViewerThemeMessage;
