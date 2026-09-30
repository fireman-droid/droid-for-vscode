import type { SessionContextStats } from './contextState';
import {
  MCP_AUTH_PHASES,
  MCP_SERVER_STATUSES,
  MCP_SERVER_TYPES,
  PLUGIN_SCOPES,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  SKILL_LOCATIONS,
} from './bounds';

export type McpServerType = (typeof MCP_SERVER_TYPES)[number];

export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export type SessionInteractionMode = (typeof SESSION_INTERACTION_MODES)[number];

export type SessionAutonomyLevel = (typeof SESSION_AUTONOMY_LEVELS)[number];

export type SessionReasoningEffort = (typeof SESSION_REASONING_EFFORTS)[number];

export interface SessionContextRefreshMessage {
  readonly type: 'session.context.refresh';
  readonly sessionId: string;
}

/** Re-reads the active runtime's model catalog without replacing the session. */
export interface ModelCatalogRefreshMessage {
  readonly type: 'session.model-catalog.refresh';
  readonly sessionId: string;
}

/** Requests the current Droid skill catalog for the session. */
export interface SkillsRefreshMessage {
  readonly type: 'skills.refresh';
  readonly sessionId: string;
}

/**
 * Requests the installed Droid plugin list and marketplace count for
 * the session. Served by the host's daemon sidecar (`plugins` and
 * `marketplaces` are daemon-only resources), not the session runtime.
 */
export interface PluginsRefreshMessage {
  readonly type: 'plugins.refresh';
  readonly sessionId: string;
}

/** Enables or disables a Droid skill by name. */
export interface SkillToggleMessage {
  readonly type: 'skill.toggle';
  readonly sessionId: string;
  readonly name: string;
  readonly disabled: boolean;
}

/** Requests the custom Droid command catalog for the session. */
export interface CommandsRefreshMessage {
  readonly type: 'commands.refresh';
  readonly sessionId: string;
}

/** Requests the current MCP server and tool catalog for the session. */
export interface McpRefreshMessage {
  readonly type: 'mcp.refresh';
  readonly sessionId: string;
}

/** Enables or disables an MCP server by name. */
export interface McpServerToggleMessage {
  readonly type: 'mcp.server.toggle';
  readonly sessionId: string;
  readonly name: string;
  readonly enabled: boolean;
}

/**
 * Registers a new MCP server at the user settings level. Stdio
 * servers carry a launch command with optional arguments; http and
 * sse servers carry an endpoint URL.
 */
export interface McpServerAddMessage {
  readonly type: 'mcp.server.add';
  readonly sessionId: string;
  readonly name: string;
  readonly serverType: McpServerType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}

/** Removes an MCP server by name at the user settings level. */
export interface McpServerRemoveMessage {
  readonly type: 'mcp.server.remove';
  readonly sessionId: string;
  readonly name: string;
}

/**
 * Starts browser OAuth authentication for an MCP server. The host
 * reports progress via `mcp.auth` messages.
 */
export interface McpServerAuthenticateMessage {
  readonly type: 'mcp.server.authenticate';
  readonly sessionId: string;
  readonly name: string;
}

export type SessionSettingUpdateMessage =
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'interactionMode';
      readonly value: SessionInteractionMode;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'modelId';
      readonly value: string;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'reasoningEffort';
      readonly value: SessionReasoningEffort;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'autonomyLevel';
      readonly value: SessionAutonomyLevel;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      /** Model used while drafting in Spec mode; null resets to the session model. */
      readonly field: 'specModeModelId';
      readonly value: string | null;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      /** Reasoning effort while drafting in Spec mode; null resets to the model default. */
      readonly field: 'specModeReasoningEffort';
      readonly value: SessionReasoningEffort | null;
    };

export interface ConfirmedSessionSettings {
  readonly interactionMode: SessionInteractionMode;
  readonly modelId: string;
  readonly reasoningEffort: SessionReasoningEffort;
  readonly autonomyLevel: SessionAutonomyLevel;
  /** Spec-mode drafting model; null when the session model is used. */
  readonly specModeModelId: string | null;
  /** Spec-mode reasoning effort; null when the model default is used. */
  readonly specModeReasoningEffort: SessionReasoningEffort | null;
}

export type SessionSettingsState =
  | {
      readonly status: 'loading';
      readonly value: ConfirmedSessionSettings | null;
    }
  | {
      readonly status: 'ready';
      readonly value: ConfirmedSessionSettings;
    }
  | {
      readonly status: 'updating';
      readonly value: ConfirmedSessionSettings;
    }
  | {
      readonly status: 'error';
      readonly value: ConfirmedSessionSettings | null;
      readonly message: string;
    };

export type SessionContextState =
  | {
      readonly status: 'loading';
      readonly value: SessionContextStats | null;
    }
  | {
      readonly status: 'ready';
      readonly value: SessionContextStats;
    }
  | {
      readonly status: 'error';
      readonly value: SessionContextStats | null;
      readonly message: string;
    };

export interface ModelCatalogItem {
  readonly id: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly SessionReasoningEffort[];
  readonly defaultReasoningEffort: SessionReasoningEffort;
  readonly isCustom: boolean;
  readonly supportsImages: boolean;
  readonly supportsImageGeneration: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export type ModelCatalogState =
  | {
      readonly status: 'loading';
      readonly items: readonly [];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly ModelCatalogItem[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly [];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

export type SkillLocation = (typeof SKILL_LOCATIONS)[number];

export interface SkillSummary {
  readonly name: string;
  readonly description: string | null;
  readonly location: SkillLocation;
  readonly enabled: boolean;
  readonly userInvocable: boolean;
}

export type SessionSkillsState =
  | {
      readonly status: 'loading';
      readonly items: readonly SkillSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly SkillSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly SkillSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * One installed Droid plugin, projected from the daemon's
 * `plugins.listInstalled` RPC. Display metadata only: install paths
 * and timestamps stay on the host.
 */
export interface PluginSummary {
  readonly id: string;
  readonly scope: PluginScope;
  /** Short content hash of the installed plugin version. */
  readonly version: string;
  /** Whether the plugin is currently enabled for new sessions. */
  readonly active: boolean;
}

/**
 * Read-only plugins panel state. `marketplaceCount` is the number of
 * registered plugin marketplaces (`marketplaces.list`); it only
 * exists on `ready` because the two RPCs resolve together.
 */
export type SessionPluginsState =
  | {
      readonly status: 'loading';
      readonly items: readonly PluginSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly PluginSummary[];
      readonly marketplaceCount: number;
    }
  | {
      readonly status: 'error';
      readonly items: readonly PluginSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * One custom slash command discovered from `.factory/commands`.
 * Names are file-slug identifiers; hints and descriptions come from
 * the command file's frontmatter.
 */
export interface CommandSummary {
  readonly name: string;
  readonly description: string | null;
  readonly argumentHint: string | null;
  readonly isExecutable: boolean;
}

export type SessionCommandsState =
  | {
      readonly status: 'loading';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly recent: readonly [];
      readonly message: string;
    };

export type McpServerStatus = (typeof MCP_SERVER_STATUSES)[number];

export interface McpToolSummary {
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly readOnly: boolean;
}

export interface McpServerSummary {
  readonly name: string;
  readonly status: McpServerStatus;
  readonly toolCount: number | null;
  readonly requiresAuth: boolean;
  /**
   * True when Droid already holds OAuth tokens for this server. A
   * server needs authentication only when `requiresAuth` is true and
   * this is false; dropping this field made signed-in servers render
   * a misleading "needs auth" badge.
   */
  readonly hasAuthTokens: boolean;
  readonly tools: readonly McpToolSummary[];
}

export type McpAuthPhase = (typeof MCP_AUTH_PHASES)[number];

export type SessionMcpState =
  | {
      readonly status: 'loading';
      readonly items: readonly McpServerSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly McpServerSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly McpServerSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

export interface SessionSettingsStateMessage {
  readonly type: 'session.settings';
  readonly sequence: number;
  readonly sessionId: string;
  readonly settings: SessionSettingsState;
}

export interface SessionContextStateMessage {
  readonly type: 'session.context';
  readonly sequence: number;
  readonly sessionId: string;
  readonly context: SessionContextState;
}

export interface ModelCatalogStateMessage {
  readonly type: 'session.model-catalog';
  readonly sequence: number;
  readonly sessionId: string;
  readonly modelCatalog: ModelCatalogState;
}

export interface SessionSkillsStateMessage {
  readonly type: 'session.skills';
  readonly sequence: number;
  readonly sessionId: string;
  readonly skills: SessionSkillsState;
}

/**
 * Installed plugins and marketplace count of the active session,
 * answered through the daemon sidecar for a `plugins.refresh`
 * request.
 */
export interface SessionPluginsStateMessage {
  readonly type: 'session.plugins';
  readonly sequence: number;
  readonly sessionId: string;
  readonly plugins: SessionPluginsState;
}

export interface SessionMcpStateMessage {
  readonly type: 'session.mcp';
  readonly sequence: number;
  readonly sessionId: string;
  readonly mcp: SessionMcpState;
}

export interface SessionCommandsStateMessage {
  readonly type: 'session.commands';
  readonly sequence: number;
  readonly sessionId: string;
  readonly commands: SessionCommandsState;
}

/**
 * Progress of one browser OAuth authentication flow for an MCP
 * server. `started` means the host accepted the request; `browser`
 * means the OAuth URL was opened (or Droid reported none) and the
 * host is waiting for the outcome; the remaining phases are terminal.
 */
export interface McpAuthStateMessage {
  readonly type: 'mcp.auth';
  readonly sequence: number;
  readonly sessionId: string;
  readonly serverName: string;
  readonly phase: McpAuthPhase;
  readonly message: string | null;
}
