import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  HostToWebviewMessage,
  ThemePreference,
  WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { App } from '../assistant/App';
import {
  ModelsPage,
  ProviderEditor,
} from '../assistant/ModelsPage';
import {
  CustomModelsContext,
  type CustomModelsFlowValue,
} from '../assistant/customModelsFlow';
import '../assistant/styles.css';
import { type StudioScenarioId } from './scenarios';
import { StudioControls } from './StudioControls';
import {
  assertStudioScenario,
  assertStudioTheme,
  assertStudioWidth,
  createStudioRuntime,
  parseStudioConfig,
  writeStudioConfig,
  type StudioApi,
  type StudioConfig,
  type StudioViewportWidth,
} from './studioRuntime';
import { createBrowserRuntime } from './browserRuntime';
import './preview.css';

const provider = {
  id: 'preview-provider',
  displayName: 'Personal Gateway',
  protocol: 'anthropic' as const,
  rootUrl: 'https://pvtstack.com',
  apiBaseUrl: 'https://pvtstack.com/v1',
  hasApiKey: true,
  imported: false,
  modelCount: 3,
};

const items = [
  {
    rawIndex: 0,
    model: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    provider: 'anthropic',
    baseUrl: provider.apiBaseUrl,
    hasApiKey: true,
    hasBedrockConfig: false,
    isValid: true,
  },
  {
    rawIndex: 1,
    model: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    baseUrl: provider.apiBaseUrl,
    hasApiKey: true,
    hasBedrockConfig: false,
    isValid: true,
  },
  {
    rawIndex: 2,
    model: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    baseUrl: provider.apiBaseUrl,
    hasApiKey: true,
    hasBedrockConfig: false,
    isValid: true,
  },
] as const;

const noop = (): void => {};
const flow: CustomModelsFlowValue = {
  sessionId: 'studio-session',
  customModels: { status: 'ready', items },
  discovery: { status: 'ready', items },
  providers: {
    status: 'ready',
    providers: [
      provider,
      {
        ...provider,
        id: 'imported',
        displayName: 'Imported',
        hasApiKey: false,
        imported: true,
        modelCount: 2,
      },
    ],
  },
  onOpenManager: noop,
  onRefresh: noop,
  onSave: noop,
  onDelete: noop,
  onDiscover: noop,
  onImport: noop,
  onRefreshProviders: noop,
  onSaveProvider: noop,
  onFetchProvider: noop,
  onImportProviderModels: noop,
  onSaveProviderModel: noop,
  onTestProviderModel: noop,
  onTestAllProviderModels: noop,
};
let previewProviders = [...flow.providers.providers];

function handlePreviewPostMessage(
  message: WebviewToHostMessage,
  emit: (message: HostToWebviewMessage) => void,
): void {
  if (message.type === 'providerModels.refresh') {
    emit({
      type: 'providerModels.state',
      sequence: nextAuxiliarySequence(),
      sessionId: message.sessionId,
      providers: { status: 'ready', providers: previewProviders },
    });
    return;
  }
  if (message.type === 'providerModels.saveProvider') {
    const previous =
      message.providerId === undefined
        ? undefined
        : previewProviders.find(
            (candidate) => candidate.id === message.providerId,
          );
    const saved = {
      id: previous?.id ?? 'preview-created-provider',
      displayName: message.displayName,
      protocol: message.protocol,
      rootUrl: message.rootUrl,
      apiBaseUrl: message.rootUrl.replace(/\/+$/u, ''),
      hasApiKey: message.setApiKey === true || previous?.hasApiKey === true,
      imported: false,
      modelCount: previous?.modelCount ?? 0,
    };
    previewProviders = [
      ...previewProviders.filter((candidate) => candidate.id !== saved.id),
      saved,
    ];
    emit({
      type: 'providerModels.state',
      sequence: nextAuxiliarySequence(),
      sessionId: message.sessionId,
      providers: { status: 'ready', providers: previewProviders },
    });
    return;
  }
  if (message.type === 'customModels.refresh') {
    emit({
      type: 'customModels.state',
      sequence: nextAuxiliarySequence(),
      sessionId: message.sessionId,
      customModels:
        flow.customModels.status === 'idle'
          ? { status: 'ready', items: [] }
          : flow.customModels,
    });
    return;
  }
  if (message.type === 'providerModels.fetch') {
    emit({
      type: 'customModels.discovery',
      sequence: nextAuxiliarySequence(),
      sessionId: message.sessionId,
      discovery:
        flow.discovery.status === 'idle'
          ? { status: 'ready', items: [] }
          : flow.discovery,
    });
  }
}

let auxiliarySequence = 100_000;
function nextAuxiliarySequence(): number {
  auxiliarySequence += 1;
  return auxiliarySequence;
}

const live = window.location.pathname === '/live';
const initialConfig = parseStudioConfig(window.location.search);
const runtime = live
  ? createBrowserRuntime()
  : createStudioRuntime(initialConfig, {
      onPostMessage: handlePreviewPostMessage,
    });

(globalThis as {
  acquireVsCodeApi?: () => typeof runtime;
  __dvxApi?: typeof runtime;
}).acquireVsCodeApi = () => runtime;

function Preview(): React.JSX.Element {
  if (live) {
    return <App />;
  }
  const path = window.location.pathname;
  if (path === '/' || path === '/app') {
    return <Studio />;
  }
  const content = path.endsWith('/provider') ? (
    <ProviderEditor
      provider={provider}
      providers={flow.providers.providers}
      items={items}
      discovery={flow.discovery}
      busy={false}
      onBack={noop}
      onSave={noop}
      onFetch={noop}
      onImport={noop}
      onSaveModel={noop}
      onTest={noop}
      onTestAll={noop}
      onDelete={noop}
    />
  ) : (
    <ModelsPage onClose={noop} />
  );

  return (
    <CustomModelsContext.Provider value={flow}>
      <div
        className="dvx-shell dvx-dev-shell"
        data-theme="dark"
        data-dvx-theme-preference="auto"
      >
        {content}
      </div>
    </CustomModelsContext.Provider>
  );
}

function Studio(): React.JSX.Element {
  const studioRuntime = runtime as ReturnType<typeof createStudioRuntime>;
  const [config, setConfig] = useState(initialConfig);
  const [appKey, setAppKey] = useState(0);

  const applyConfig = useCallback(
    (nextConfig: StudioConfig, resetState = false): void => {
      studioRuntime.configure(nextConfig, resetState);
      writeStudioConfig(nextConfig);
      setConfig(nextConfig);
      if (resetState) {
        setAppKey((value) => value + 1);
      }
    },
    [],
  );
  const setScenario = useCallback(
    (scenario: StudioScenarioId): void => {
      applyConfig({ ...studioRuntime.getConfig(), scenario }, true);
    },
    [applyConfig],
  );
  const setTheme = useCallback(
    (theme: ThemePreference): void => {
      applyConfig({ ...studioRuntime.getConfig(), theme });
    },
    [applyConfig],
  );
  const setWidth = useCallback(
    (width: StudioViewportWidth): void => {
      applyConfig({ ...studioRuntime.getConfig(), width });
    },
    [applyConfig],
  );
  const reset = useCallback((): void => {
    applyConfig(studioRuntime.getConfig(), true);
  }, [applyConfig]);

  const studioApi = useMemo<StudioApi>(
    () => ({
      getState: studioRuntime.getConfig,
      setScenario: (scenario) => {
        assertStudioScenario(scenario);
        setScenario(scenario);
      },
      setTheme: (theme) => {
        assertStudioTheme(theme);
        setTheme(theme);
      },
      setWidth: (width) => {
        assertStudioWidth(width);
        setWidth(width);
      },
      reset,
    }),
    [reset, setScenario, setTheme, setWidth],
  );
  useEffect(() => {
    const target = globalThis as { __dvxStudio?: StudioApi };
    target.__dvxStudio = studioApi;
    return () => {
      delete target.__dvxStudio;
    };
  }, [studioApi]);

  return (
    <main className="dvx-studio">
      <StudioControls
        config={config}
        onScenarioChange={setScenario}
        onThemeChange={setTheme}
        onWidthChange={setWidth}
        onReset={reset}
      />
      <section className="dvx-studio-stage" aria-label="Webview preview">
        <div
          className="dvx-studio-viewport"
          style={{ width: `${config.width}px` }}
          data-studio-width={config.width}
        >
          <App key={appKey} />
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Webview Lab root was not found.');
}
createRoot(root).render(<Preview />);
