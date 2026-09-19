import { type AttachmentStage } from '../../../shared/bridgeMessages';
import {
  type AttachmentSummary,
  type ImageMediaType,
} from '../../../shared/protocol/attachments';
import {
  type ModelCatalogState,
  type SessionCommandsState,
  type SessionContextState,
  type SessionSettingsState,
} from '../../../shared/protocol/settings';
import type { SessionTokenUsageState } from '../../../shared/protocol/tokenUsage';
import type { AttachmentImageEntry } from '../state/store';
import type {
  ComposerNavRequest,
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  PluginsPanelState,
  SessionSettingSelection,
  SkillsPanelState,
} from './ComposerControls';
import type { SlashNavTarget } from './slashBuiltins';

export interface FileSearchResult {
  readonly requestId: string;
  /** 'no-workspace' means no folder is open, so search cannot run. */
  readonly status: 'ok' | 'no-workspace';
  readonly files: readonly string[];
}

export type SlashCommandsState =
  | SessionCommandsState
  | {
      readonly status: 'idle';
      readonly items: readonly [];
      readonly recent: readonly [];
    };

export interface ThreadComposerProps {
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly tokenUsage: SessionTokenUsageState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
  readonly onContextRefresh: () => void;
  readonly compactPending: boolean;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onPluginsRefresh: () => void;
  /** Starts a fresh session (skill changes apply at session start). */
  readonly onNewSession: () => void;
  readonly attachments: readonly AttachmentSummary[];
  readonly attachmentImages: Readonly<Record<string, AttachmentImageEntry>>;
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly commands: SlashCommandsState;
  readonly onCommandsRefresh: () => void;
  /** Latest `/command` panel-navigation request (ComposerControls). */
  readonly navSignal?: ComposerNavRequest | null;
  /** Opens the panel behind one `/` popup navigation row. */
  readonly onSlashNavigate?: (target: SlashNavTarget) => void;
  /** Opens official Mission setup from the Composer slash catalog. */
  readonly missionActive?: boolean;
  readonly onMissionOpen?: () => void;
  /**
   * Host-advertised `/btw` side-chat capability (process runtime
   * only); false keeps the popup row unrendered (fail closed).
   */
  readonly btwAvailable?: boolean;
  /**
   * Opens the side-chat card from the `/btw` popup row. Direct (no
   * composer send) so it stays usable while a main turn runs.
   */
  readonly onBtwOpen?: () => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachImage: (
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onAttachPdf: (name: string, dataBase64: string) => void;
  readonly onAttachRemoteImage: (url: string) => void;
  readonly onAttachUris: (uris: readonly string[]) => void;
  readonly onAttachTextFile: (name: string, text: string, truncated: boolean) => void;
  readonly onAttachmentReadImage: (attachmentId: string, stage?: AttachmentStage) => void;
  readonly onAttachmentReplaceImage: (
    attachmentId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
    stage?: AttachmentStage,
  ) => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
  /** Prompts queued behind the running turn (Composer hint). */
  readonly queuedCount?: number;
  /** A queued prompt is loaded into the Composer ("Edit Queued"). */
  readonly queueEditing?: boolean;
  /** Leaves "Edit Queued" mode, clearing the Composer draft. */
  readonly onQueueEditCancel?: () => void;
}
