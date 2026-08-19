import { createRoot } from 'react-dom/client';

import {
  BRIDGE_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { MISSION_BRIDGE_PROTOCOL_VERSION } from '../../shared/missionProtocol';
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
const longTranscript = Array.from({ length: 90 }, (_, index) => [
  { id: `long-user-${index}`, kind: 'user' as const, text: `Question ${index}` },
  {
    id: `long-assistant-${index}`,
    kind: 'assistant' as const,
    turnId: `long-turn-${index}`,
    text: `Answer ${index}\n\n${'Long answer content. '.repeat(8)}`,
  },
]).flat();
const flow: CustomModelsFlowValue = {
  sessionId: 'preview-session',
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

let sequence = 0;
const emit = (message: HostToWebviewMessage): void => {
  window.setTimeout(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
};

const snapshot = (): HostToWebviewMessage => ({
  type: 'host.snapshot',
  sequence: sequence++,
  sessionId: 'preview-session',
  connection: { status: 'connected' },
  turn: null,
  sessions: {
    status: 'ready',
    items: [{
      id: 'preview-session',
      title: 'Webview Lab',
      messageCount: 2,
      modifiedTime: '2026-08-17T12:00:00.000Z',
      active: true,
      isFavorite: false,
    }],
  },
  settings: {
    status: 'ready',
    value: {
      interactionMode: 'auto',
      modelId: 'factory/gpt-5.6',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    },
  },
  context: {
    status: 'ready',
    value: {
      availability: 'available',
      used: 24_000,
      remaining: 176_000,
      limit: 200_000,
    },
  },
  modelCatalog: {
    status: 'ready',
    items: [{
      id: 'factory/gpt-5.6',
      displayName: 'GPT-5.6',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    }],
  },
  transcript: new URLSearchParams(window.location.search).has('longHistory')
    ? longTranscript
    : [
        { id: 'preview-user', kind: 'user', text: 'Review the current workspace.' },
        {
          id: 'preview-assistant',
          kind: 'assistant',
          turnId: 'preview-turn',
          text: 'The browser lab is connected to development fixtures.',
        },
      ],
  historyStatus: 'complete',
  truncated: false,
});

const missionSnapshot = (): HostToWebviewMessage => ({
  type: 'mission.snapshot',
  protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
  sequence: sequence++,
  scope: 'selected-chat',
  revision: 0,
  availability: 'attached',
  features: [],
  completedFeatureCount: 0,
  controls: {
    canPause: false,
    canResume: false,
    canStopCurrentFeature: false,
  },
  validator: {
    scrutinyEnabled: true,
    userTestingEnabled: true,
  },
  setup: {
    currentChat: {
      modelId: 'factory/gpt-5.6',
      reasoningEffort: 'high',
    },
    catalogStatus: 'ready',
    catalog: [{
      id: 'factory/gpt-5.6',
      displayName: 'GPT-5.6',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    }],
    preferences: {
      worker: {
        mode: 'same-as-orchestrator',
        modelId: 'factory/gpt-5.6',
        reasoningEffort: 'high',
      },
      validator: {
        mode: 'same-as-orchestrator',
        modelId: 'factory/gpt-5.6',
        reasoningEffort: 'high',
      },
      scrutinyEnabled: true,
      userTestingEnabled: true,
    },
  },
});

const previewApi = {
  getState: (): unknown => ({}),
  setState: (_state: unknown): void => {},
  postMessage: (message: WebviewToHostMessage): void => {
    if (
      message.type === 'webview.ready' &&
      message.protocolVersion === BRIDGE_PROTOCOL_VERSION
    ) {
      emit(snapshot());
      emit(missionSnapshot());
      return;
    }
    if (message.type === 'providerModels.refresh') {
      emit({
        type: 'providerModels.state',
        sequence: sequence++,
        sessionId: message.sessionId,
        providers: { status: 'ready', providers: previewProviders },
      });
      return;
    }
    if (message.type === 'providerModels.saveProvider') {
      const previous = message.providerId === undefined
        ? undefined
        : previewProviders.find((candidate) => candidate.id === message.providerId);
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
        sequence: sequence++,
        sessionId: message.sessionId,
        providers: { status: 'ready', providers: previewProviders },
      });
      return;
    }
    if (message.type === 'customModels.refresh') {
      emit({
        type: 'customModels.state',
        sequence: sequence++,
        sessionId: message.sessionId,
        customModels: flow.customModels.status === 'idle'
          ? { status: 'ready', items: [] }
          : flow.customModels,
      });
      return;
    }
    if (message.type === 'providerModels.fetch') {
      emit({
        type: 'customModels.discovery',
        sequence: sequence++,
        sessionId: message.sessionId,
        discovery: flow.discovery.status === 'idle'
          ? { status: 'ready', items: [] }
          : flow.discovery,
      });
    }
  },
};

(globalThis as {
  acquireVsCodeApi?: () => typeof previewApi;
  __dvxApi?: typeof previewApi;
}).acquireVsCodeApi = () => previewApi;

function Preview(): React.JSX.Element {
  const path = window.location.pathname;
  if (path === '/' || path === '/app') {
    return <App />;
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

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Webview Lab root was not found.');
}
createRoot(root).render(<Preview />);
