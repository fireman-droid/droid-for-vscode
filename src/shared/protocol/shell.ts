import { BRIDGE_PROTOCOL_VERSION } from '../bridgeMessages';
import { CONNECTION_STATUSES, THEME_PREFERENCES } from './bounds';

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export interface WebviewReadyMessage {
  readonly type: 'webview.ready';
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  /** Chat pages opt into state application receipts; auxiliary panels do not. */
  readonly pageId?: string;
}

export interface WebviewStateAppliedMessage {
  readonly type: 'webview.state-applied';
  readonly pageId: string;
  /** Exact applied messages, not a cumulative acknowledgement across possible gaps. */
  readonly sequences: readonly number[];
  readonly snapshotSequence: number | null;
}

export interface RuntimeRetryMessage {
  readonly type: 'runtime.retry';
  readonly sessionId: string | null;
}

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Webview → Host: persist a new theme preference. Handled by the
 * view provider (writes user settings); never reaches the session
 * controller.
 */
export interface UiThemeSetMessage {
  readonly type: 'ui.theme.set';
  readonly preference: ThemePreference;
}

/**
 * Host → Webview: current preference plus its editor-resolved theme.
 * Sent on ready and preference/editor-theme changes. Carries no
 * `sequence` on purpose: it bypasses the
 * session store (which enforces one monotonic sequence across all
 * controller-emitted messages) and is applied directly by the shell.
 */
export interface UiThemeMessage {
  readonly type: 'ui.theme';
  readonly preference: ThemePreference;
  readonly resolved: 'light' | 'dark';
}

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly message?: string;
}

export interface HostConnectionMessage {
  readonly type: 'host.connection';
  readonly sequence: number;
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
}

/**
 * Announces the SDK message id assigned to the user prompt of a live
 * turn so the webview can enable edit-and-resend for it.
 */
export interface UserMessageMetaMessage {
  readonly type: 'user.message-meta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  /** Time the Host accepted this prompt, in Unix milliseconds. */
  readonly timestamp?: number;
}
