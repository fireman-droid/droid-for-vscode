import type {
  AttachmentStage,
  ImageMediaType,
  ModelCatalogState,
  SessionContextState,
  SessionSettingsState,
} from '../../shared/bridgeMessages';
import type {
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  PluginsPanelState,
  SessionSettingSelection,
  SkillsPanelState,
} from './ComposerControls';
import type { AttachmentImageEntry } from './store';

export interface UserEditorEnv {
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
  readonly mcpAuth: McpAuthProgress | null;
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly onContextRefresh: () => void;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onPluginsRefresh: () => void;
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
  readonly onAttachTextFile: (
    name: string,
    text: string,
    truncated: boolean,
  ) => void;
  readonly attachmentImages: Readonly<Record<string, AttachmentImageEntry>>;
  readonly onAttachmentReadImage: (
    attachmentId: string,
    stage?: AttachmentStage,
  ) => void;
  readonly onAttachmentReplaceImage: (
    attachmentId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
    stage?: AttachmentStage,
  ) => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
}
