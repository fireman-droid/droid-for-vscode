import {
  BRIDGE_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { type ThemePreference } from '../../shared/protocol/shell';
import {
  getStudioScenario,
  isStudioScenarioId,
  type StudioScenarioId,
} from './scenarios';

export const STUDIO_VIEWPORT_WIDTHS = [320, 400, 480, 760] as const;
export type StudioViewportWidth = (typeof STUDIO_VIEWPORT_WIDTHS)[number];

export interface StudioConfig {
  readonly scenario: StudioScenarioId;
  readonly theme: ThemePreference;
  readonly width: StudioViewportWidth;
}

export interface StudioApi {
  readonly getState: () => StudioConfig;
  readonly setScenario: (scenario: StudioScenarioId) => void;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setWidth: (width: StudioViewportWidth) => void;
  readonly reset: () => void;
}

export interface StudioRuntime {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: WebviewToHostMessage): void;
  getConfig(): StudioConfig;
  configure(config: StudioConfig, resetState?: boolean): void;
  replay(): void;
  emit(message: HostToWebviewMessage): void;
}

interface StudioRuntimeOptions {
  readonly onPostMessage?: (
    message: WebviewToHostMessage,
    emit: (message: HostToWebviewMessage) => void,
  ) => void;
}

const DEFAULT_CONFIG: StudioConfig = {
  scenario: 'full-workflow',
  theme: 'auto',
  width: 480,
};

export function parseStudioConfig(search: string): StudioConfig {
  const params = new URLSearchParams(search);
  const scenarioValue = params.get('scenario');
  const themeValue = params.get('theme');
  const widthValue = Number(params.get('width'));
  return {
    scenario:
      scenarioValue !== null && isStudioScenarioId(scenarioValue)
        ? scenarioValue
        : params.has('longHistory')
          ? 'long-history'
          : DEFAULT_CONFIG.scenario,
    theme:
      themeValue === 'light' || themeValue === 'dark' || themeValue === 'auto'
        ? themeValue
        : DEFAULT_CONFIG.theme,
    width: isStudioViewportWidth(widthValue) ? widthValue : DEFAULT_CONFIG.width,
  };
}

export function writeStudioConfig(config: StudioConfig): void {
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', config.scenario);
  url.searchParams.set('theme', config.theme);
  url.searchParams.set('width', String(config.width));
  url.searchParams.delete('longHistory');
  window.history.replaceState(null, '', url);
}

export function createStudioRuntime(
  initialConfig: StudioConfig,
  options: StudioRuntimeOptions = {},
): StudioRuntime {
  let config = initialConfig;
  let persistedState: unknown = {};
  let sequence = 0;
  const timers = new Set<number>();

  const clearScheduled = (): void => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.clear();
  };

  const emit = (message: HostToWebviewMessage): void => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      window.dispatchEvent(new MessageEvent('message', { data: message }));
    });
    timers.add(timer);
  };

  const emitTheme = (): void => {
    const resolved = config.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.dvxTheme = resolved;
    document.documentElement.dataset.dvxThemePreference = config.theme;
    document.body.classList.toggle('vscode-light', resolved === 'light');
    document.body.classList.toggle('vscode-dark', resolved === 'dark');
    emit({
      type: 'ui.theme',
      preference: config.theme,
      resolved,
    });
  };

  const replay = (): void => {
    clearScheduled();
    sequence = 0;
    emitTheme();
    const scenario = getStudioScenario(config.scenario);
    for (const message of scenario.build(() => sequence++)) {
      emit(message);
    }
  };

  const runtime: StudioRuntime = {
    getState: () => persistedState,
    setState: (state) => {
      persistedState = state;
    },
    postMessage: (message) => {
      if (
        message.type === 'webview.ready' &&
        message.protocolVersion === BRIDGE_PROTOCOL_VERSION
      ) {
        replay();
        return;
      }
      if (message.type === 'ui.theme.set') {
        config = { ...config, theme: message.preference };
        emitTheme();
        return;
      }
      if (message.type === 'runtime.retry') {
        replay();
        return;
      }
      options.onPostMessage?.(message, emit);
    },
    getConfig: () => config,
    configure: (nextConfig, resetState = false) => {
      clearScheduled();
      config = nextConfig;
      if (resetState) {
        persistedState = {};
        sequence = 0;
      }
      emitTheme();
    },
    replay,
    emit,
  };
  runtime.configure(initialConfig);
  return runtime;
}

export function isStudioViewportWidth(value: number): value is StudioViewportWidth {
  return (STUDIO_VIEWPORT_WIDTHS as readonly number[]).includes(value);
}

export function assertStudioScenario(value: string): asserts value is StudioScenarioId {
  if (!isStudioScenarioId(value)) {
    throw new Error(`Unknown Droid Studio scenario: ${value}`);
  }
}

export function assertStudioTheme(value: string): asserts value is ThemePreference {
  if (value !== 'auto' && value !== 'light' && value !== 'dark') {
    throw new Error(`Unknown Droid Studio theme: ${value}`);
  }
}

export function assertStudioWidth(value: number): asserts value is StudioViewportWidth {
  if (!isStudioViewportWidth(value)) {
    throw new Error(`Unsupported Droid Studio width: ${value}`);
  }
}
