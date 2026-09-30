import {
  type ModelInfo,
  type Base64ImageSource,
  type DocumentSource,
  type DroidSessionUpdateSettingsOptions,
  type DroidStreamEvent,
  type GetContextStatsResult,
  type SessionSettings,
} from '@factory/droid-sdk/node';
import { type FactoryContextBreakdown } from '../capabilities/contextWindow';
import { type RuntimeCommand, type RuntimeGitDiffOptions, type RuntimeSessionTarget } from '../DroidRuntime';
import {
  type FactoryDroidSessionGitDiff,
  type FactoryDroidSessionRewindInfo,
  type FactoryDroidSessionRewindParams,
} from './replacementTypes';
import { type RuntimeInteractionHandler } from '../events/runtimeInteractions';
import type { RuntimeTurnOutcome } from '../turnOutcome';

export interface FactoryDroidSession {
  readonly id: string;
  appendHistoryMessage?(text: string): Promise<import('../process/appendProcessHistory').ProcessHistoryNoteResult>;
  listCommands?(): Promise<readonly RuntimeCommand[]>;
  readonly settings: Readonly<SessionSettings>;
  readonly availableModels?: readonly ModelInfo[];
  /** Reads a fresh catalog without restarting or replacing the active session. */
  readAvailableModels?(): Promise<readonly ModelInfo[] | undefined>;
  /**
   * Actual session working directory when the backend reports one.
   * Daemon sessions expose it (worktree sessions run in the worktree
   * path rather than the requested cwd); process sessions omit it.
   */
  readonly cwd?: string;
  stream(
    prompt: string,
    options: {
      includePartialMessages: true;
      abortSignal?: AbortSignal;
      images?: Base64ImageSource[];
      files?: DocumentSource[];
      /** Runtime-generated id passed unchanged to the daemon's addUserMessage. */
      backendTurnId?: string;
    },
  ): AsyncIterable<DroidStreamEvent>;
  interrupt(): Promise<void>;
  /**
   * Raw backend working-state string for this session, or null when
   * the backend no longer lists the session. Daemon sessions implement
   * it from the daemon's opened-session registry; process sessions
   * omit it (their turns cannot outlive the window).
   */
  readWorkingState?(): Promise<string | null>;
  readTurnOutcome?(backendTurnId: string): Promise<RuntimeTurnOutcome | null>;
  readMissionSnapshot?(): unknown;
  subscribeMissionSnapshot?(listener: (snapshot: unknown) => void): () => void;
  updateSettings(params: DroidSessionUpdateSettingsOptions): Promise<unknown>;
  getContextStats(): Promise<GetContextStatsResult>;
  /**
   * Official current Context Breakdown exposed by daemon sessions.
   * Process sessions omit it because their public SDK totals do not
   * match the CLI's current-context meter.
   */
  readContextBreakdown?(): Promise<FactoryContextBreakdown>;
  rewind?(
    params: FactoryDroidSessionRewindParams,
  ): Promise<{ session: FactoryDroidSession }>;
  getRewindInfo?(params: { messageId: string }): Promise<FactoryDroidSessionRewindInfo>;
  getGitDiff?(options?: RuntimeGitDiffOptions): Promise<FactoryDroidSessionGitDiff>;
  compact?(params?: {
    customInstructions?: string;
  }): Promise<{ session: FactoryDroidSession; removedCount: number }>;
  fork?(params?: { title?: string }): Promise<FactoryDroidSession>;
  rename?(params: { title: string }): Promise<void>;
  listSkills?(): Promise<{ skills: unknown[] }>;
  setSkillDisabled?(params: {
    skillName: string;
    disabled: boolean;
  }): Promise<{ success: boolean }>;
  listMcpServers?(): Promise<{ servers: unknown[] }>;
  listMcpTools?(): Promise<unknown[]>;
  toggleMcpServer?(params: {
    serverName: string;
    enabled: boolean;
    settingsLevel: 'user';
  }): Promise<{ success: boolean }>;
  addMcpServer?(params: {
    name: string;
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
  }): Promise<{ success: boolean }>;
  removeMcpServer?(params: {
    serverName: string;
    settingsLevel: 'user';
  }): Promise<{ success: boolean }>;
  authenticateMcpServer?(params: { serverName: string }): Promise<{ success: boolean }>;
  onNotification?(
    callback: (notification: Record<string, unknown>) => void,
    filter?: { type?: string },
  ): () => void;
  close(): Promise<void>;
}

export type FactoryDroidSessionFactory = (options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
}) => Promise<FactoryDroidSession>;
