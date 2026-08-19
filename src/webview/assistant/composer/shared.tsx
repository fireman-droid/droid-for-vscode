// Shared types, option tables, helpers, and small components of the
// ComposerControls popover family. Moved verbatim from
// ComposerControls.tsx (structure-only split: mode / context / model /
// settings each own a sibling module).

import type {
  McpAuthPhase,
  McpServerType,
  SessionAutonomyLevel,
  SessionInteractionMode,
  SessionMcpState,
  SessionPluginsState,
  SessionReasoningEffort,
  SessionSettingsState,
  SessionSkillsState,
  ThemePreference,
} from '../../../shared/bridgeMessages';

export type SettingsView =
  | 'root'
  | 'mode'
  | 'autonomy'
  | 'theme'
  | 'skills'
  | 'mcp'
  | 'plugins';

export type AttachSource =
  | 'files'
  | 'editor'
  | 'selection'
  | 'problems'
  | 'git-changes';

export type SkillsPanelState =
  | SessionSkillsState
  | { readonly status: 'idle'; readonly items: readonly [] };

export type McpPanelState =
  | SessionMcpState
  | { readonly status: 'idle'; readonly items: readonly [] };

export type PluginsPanelState =
  | SessionPluginsState
  | { readonly status: 'idle'; readonly items: readonly [] };

/** Progress of the one in-flight MCP browser authentication flow. */
export interface McpAuthProgress {
  readonly serverName: string;
  readonly phase: McpAuthPhase;
  readonly message: string | null;
}

/** Payload for registering a new MCP server from the MCP panel. */
export interface McpServerAddParams {
  readonly name: string;
  readonly serverType: McpServerType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}

/**
 * One slash-command navigation request targeting a composer panel
 * (`/model` `/context` `/mcp` `/skills`). The monotonic id lets the
 * same target fire again after the user closed the panel.
 */
export interface ComposerNavRequest {
  readonly id: number;
  readonly target: 'model' | 'context' | 'mcp' | 'skills';
}

export const MODE_OPTIONS: readonly {
  readonly value: SessionInteractionMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Droid chooses the best way to work.',
  },
  {
    value: 'spec',
    label: 'Spec',
    description: 'Plan and confirm the approach first.',
  },
  {
    value: 'mission',
    label: 'Mission',
    description: 'Work toward a defined outcome.',
  },
];

export const AUTONOMY_OPTIONS: readonly {
  readonly value: SessionAutonomyLevel;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'off',
    label: 'Off',
    description: 'Ask before taking autonomous steps.',
  },
  {
    value: 'low',
    label: 'Low',
    description: 'Take a small number of safe steps.',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Continue through routine work.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Proceed broadly within runtime safeguards.',
  },
];

/** Shell theme choices (webview-local; persisted as a user setting). */
export const THEME_OPTIONS: readonly {
  readonly value: ThemePreference;
  readonly label: string;
}[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsStatus({
  settings,
}: {
  readonly settings: SessionSettingsState;
}): React.JSX.Element | null {
  if (settings.status === 'updating') {
    return (
      <p className="dvx-popover-message" role="status">
        Applying setting…
      </p>
    );
  }
  if (settings.status === 'error') {
    return (
      <p className="dvx-popover-message dvx-error-text" role="alert">
        {settings.message}
      </p>
    );
  }
  return null;
}

export function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-chevron-down"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m5 6.5 3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatLabel(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

export function formatReasoningLabel(
  value: SessionReasoningEffort | undefined,
): string {
  if (value === undefined) {
    return '';
  }
  return value === 'xhigh' ? 'Extra High' : formatLabel(value);
}
