import { MAX_MODEL_CATALOG_ITEMS } from '../../shared/bridgeMessages';
import {
  CUSTOM_MODEL_PROVIDERS,
  type CustomModelDiscoveryState,
  type CustomModelsState,
  type ProviderModelsState,
  type ProviderModelsWebviewMessage,
  type CustomModelProvider,
} from '../../shared/customModelsProtocol';
import {
  canonicalProviderEndpoint,
  normalizeProviderRoot,
  resolveHttpApiBase,
  sameProviderEndpoint,
} from '../../shared/providerEndpoint';
import {
  CUSTOM_MODELS_LOAD_FAILED_MESSAGE,
  handleCustomModelSave,
  handleCustomModelsImport,
  projectCustomModelItems,
  type CustomModelsHost,
  type DaemonCustomModelRow,
} from './customModels';
import { testCustomModel } from './modelTesting';
import type { ProviderConnection, ProviderRegistry } from './providerRegistry';

const importedByHost = new WeakMap<
  CustomModelsHost,
  Map<string, ProviderConnection>
>();

export function handleProviderModels(
  ctl: CustomModelsHost,
  message: ProviderModelsWebviewMessage,
): void {
  const dropReason = ctl.sessionRequestDropReason(message.sessionId);
  if (dropReason !== null || ctl.providerRegistry === undefined) {
    if (dropReason !== null) {
      ctl.recordDroppedPanelRequest(message.type, dropReason);
    }
    return;
  }
  if (message.type === 'providerModels.refresh') {
    refreshProviders(ctl, message.sessionId);
    return;
  }
  if (message.type === 'providerModels.saveProvider') {
    saveProviderConnection(ctl, message);
    return;
  }
  const provider = resolveConnection(ctl, message.providerId);
  if (provider === null) {
    const copy = 'This connection is no longer available. Refresh and retry.';
    if (message.type === 'providerModels.fetch') {
      emitDiscovery(ctl, message.sessionId, {
        status: 'error',
        message: copy,
      });
    } else {
      refreshProviders(ctl, message.sessionId);
    }
    return;
  }
  if (message.type === 'providerModels.fetch') {
    void fetchProviderModels(ctl, message.sessionId, provider);
    return;
  }
  if (message.type === 'providerModels.test') {
    void testProviderModel(ctl, message.sessionId, provider, message.model);
    return;
  }
  if (message.type === 'providerModels.testAll') {
    void testAllProviderModels(ctl, message.sessionId, provider);
    return;
  }
  const writeUrl = normalizeProviderRoot(provider.rootUrl);
  void readProviderKey(ctl, provider).then((key) => {
    if (message.type === 'providerModels.import') {
      if (key === undefined) {
        emitDiscovery(ctl, message.sessionId, {
          status: 'error',
          message:
            'Add an API key to this connection before adding models.',
        });
        return;
      }
      handleCustomModelsImport(ctl, {
        type: 'customModels.import',
        sessionId: message.sessionId,
        provider: provider.protocol,
        baseUrl: writeUrl,
        apiKey: key,
        models: message.models,
        maxOutputTokens: message.maxOutputTokens,
        noImageSupport: message.noImageSupport,
      });
      return;
    }
    handleCustomModelSave(ctl, {
      type: 'customModels.save',
      sessionId: message.sessionId,
      provider: provider.protocol,
      baseUrl: writeUrl,
      model: message.model,
      ...(message.displayName === undefined
        ? {}
        : { displayName: message.displayName }),
      ...(message.rawIndex === undefined
        ? {}
        : { rawIndex: message.rawIndex, expectedModel: message.expectedModel }),
      ...(key === undefined ? {} : { apiKey: key }),
      maxOutputTokens: message.maxOutputTokens,
      noImageSupport: message.noImageSupport,
    });
  });
}

function saveProviderConnection(
  ctl: CustomModelsHost,
  message: Extract<
    ProviderModelsWebviewMessage,
    { type: 'providerModels.saveProvider' }
  >,
): void {
  if (ctl.customModelsOp) {
    return;
  }
  ctl.customModelsOp = true;
  const apiKey =
    message.setApiKey === true
      ? (ctl.promptProviderApiKey?.() ?? Promise.resolve(undefined))
      : Promise.resolve(undefined);
  void apiKey
    .then((key) =>
      ctl.providerRegistry!.save({
        displayName: message.displayName,
        protocol: message.protocol,
        rootUrl: message.rootUrl,
        ...(key === undefined || key.length === 0 ? {} : { apiKey: key }),
        ...(message.providerId === undefined ? {} : { id: message.providerId }),
      }),
    )
    .then(
      () => {
        ctl.customModelsOp = false;
        refreshProviders(ctl, message.sessionId);
      },
      () => {
        ctl.customModelsOp = false;
        emitProviderModels(ctl, message.sessionId, {
          status: 'error',
          providers: [],
          message: 'Could not save this connection.',
        });
      },
    );
}

function refreshProviders(ctl: CustomModelsHost, sessionId: string): void {
  if (
    ctl.customModelsOp ||
    ctl.daemonCustomModels === undefined ||
    ctl.providerRegistry === undefined
  ) {
    return;
  }
  ctl.customModelsOp = true;
  void ctl
    .daemonCustomModels()
    .then((resource) => resource.list())
    .then(
      async (models) => {
        ctl.customModelsOp = false;
        const providers = await projectProviderConnections(
          ctl,
          ctl.providerRegistry!.list(),
          models,
          ctl.providerRegistry!,
          ctl.providerTests,
        );
        emitProviderModels(ctl, sessionId, { status: 'ready', providers });
        emitModels(ctl, sessionId, {
          status: 'ready',
          items: projectCustomModelItems(models),
        });
      },
      () => {
        ctl.customModelsOp = false;
        emitProviderModels(ctl, sessionId, {
          status: 'error',
          providers: [],
          message: CUSTOM_MODELS_LOAD_FAILED_MESSAGE,
        });
      },
    );
}

async function fetchProviderModels(
  ctl: CustomModelsHost,
  sessionId: string,
  provider: ProviderConnection,
): Promise<void> {
  if (ctl.customModelsOp || ctl.modelDiscovery === undefined) {
    return;
  }
  const key = await requireProviderKey(ctl, provider);
  if (key === undefined) {
    emitDiscovery(ctl, sessionId, {
      status: 'error',
      message: 'Add an API key to this connection before fetching models.',
    });
    return;
  }
  ctl.customModelsOp = true;
  emitDiscovery(ctl, sessionId, { status: 'loading' });
  try {
    const items = await ctl.modelDiscovery.discover({
      provider: provider.protocol,
      baseUrl: resolveHttpApiBase(provider.protocol, provider.rootUrl),
      apiKey: key,
    });
    emitDiscovery(ctl, sessionId, { status: 'ready', items });
  } catch {
    emitDiscovery(ctl, sessionId, {
      status: 'error',
      message: 'Could not fetch models from this connection.',
    });
  } finally {
    ctl.customModelsOp = false;
  }
}

async function testProviderModel(
  ctl: CustomModelsHost,
  sessionId: string,
  provider: ProviderConnection,
  model: string,
): Promise<void> {
  if (ctl.customModelsOp) {
    return;
  }
  const key = await requireProviderKey(ctl, provider);
  if (key === undefined) {
    rememberTest(ctl, provider.id, model, {
      status: 'failed',
      summary: 'Add an API key to this connection before testing a model.',
      latencyMs: 0,
    });
    refreshProviders(ctl, sessionId);
    return;
  }
  ctl.customModelsOp = true;
  try {
    rememberTest(
      ctl,
      provider.id,
      model,
      await testCustomModel({
        protocol: provider.protocol,
        baseUrl: provider.rootUrl,
        apiKey: key,
        model,
      }),
    );
  } finally {
    ctl.customModelsOp = false;
  }
  refreshProviders(ctl, sessionId);
}

async function testAllProviderModels(
  ctl: CustomModelsHost,
  sessionId: string,
  provider: ProviderConnection,
): Promise<void> {
  if (ctl.customModelsOp || ctl.daemonCustomModels === undefined) {
    return;
  }
  const key = await requireProviderKey(ctl, provider);
  if (key === undefined) {
    ctl.providerTests.set(provider.id, {
      status: 'failed',
      summary: 'Add an API key to this connection before testing models.',
      latencyMs: 0,
    });
    refreshProviders(ctl, sessionId);
    return;
  }
  ctl.customModelsOp = true;
  try {
    const rows = (await (await ctl.daemonCustomModels()).list())
      .filter((row) => belongsToProvider(row, provider))
      .slice(0, 16);
    let passed = 0;
    let latencyMs = 0;
    for (const row of rows) {
      const result = await testCustomModel({
        protocol: provider.protocol,
        baseUrl: provider.rootUrl,
        apiKey: key,
        model: row.model,
      });
      rememberTest(ctl, provider.id, row.model, result);
      if (result.status === 'passed') {
        passed += 1;
      }
      latencyMs += result.latencyMs;
    }
    ctl.providerTests.set(provider.id, {
      status: rows.length > 0 && passed === rows.length ? 'passed' : 'failed',
      summary:
        rows.length === 0
          ? 'No models saved on this connection to test.'
          : `${passed} of ${rows.length} models replied.`,
      latencyMs,
    });
  } finally {
    ctl.customModelsOp = false;
  }
  refreshProviders(ctl, sessionId);
}

async function projectProviderConnections(
  ctl: CustomModelsHost,
  configured: readonly ProviderConnection[],
  models: readonly DaemonCustomModelRow[],
  registry: ProviderRegistry,
  tests: ReadonlyMap<
    string,
    {
      readonly status: 'passed' | 'failed';
      readonly summary: string;
      readonly latencyMs: number;
    }
  >,
): Promise<ProviderModelsState['providers']> {
  const imported = importedProviders(ctl);
  imported.clear();
  const saved = await Promise.all(
    configured.slice(0, MAX_MODEL_CATALOG_ITEMS).map(async (provider) =>
      projectSummary(provider, models, tests, await registry.hasApiKey(provider.id), false),
    ),
  );
  const claimed = new Set(
    saved.map(
      (provider) =>
        `${provider.protocol}\u0000${canonicalProviderEndpoint(provider.rootUrl)}`,
    ),
  );
  for (const row of models) {
    if (
      saved.length >= MAX_MODEL_CATALOG_ITEMS ||
      !(CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(row.provider) ||
      row.baseUrl === undefined ||
      claimed.has(
        `${row.provider}\u0000${canonicalProviderEndpoint(row.baseUrl)}`,
      )
    ) {
      continue;
    }
    claimed.add(
      `${row.provider}\u0000${canonicalProviderEndpoint(row.baseUrl)}`,
    );
    const connection: ProviderConnection = {
      id: `imported:${saved.length}`,
      displayName: 'Imported connection',
      protocol: row.provider as CustomModelProvider,
      rootUrl: normalizeProviderRoot(row.baseUrl),
      apiBaseUrl: normalizeProviderRoot(row.baseUrl),
    };
    imported.set(connection.id, connection);
    saved.push(
      projectSummary(
        connection,
        models,
        tests,
        false,
        true,
      ),
    );
  }
  return saved;
}

function projectSummary(
  provider: ProviderConnection,
  models: readonly DaemonCustomModelRow[],
  tests: ReadonlyMap<
    string,
    {
      readonly status: 'passed' | 'failed';
      readonly summary: string;
      readonly latencyMs: number;
    }
  >,
  hasApiKey: boolean,
  imported: boolean,
): ProviderModelsState['providers'][number] {
  const modelTests = [...tests.entries()]
    .filter(([key]) => key.startsWith(`${provider.id}\u0000`))
    .map(([key, result]) => ({
      model: key.slice(provider.id.length + 1),
      ...result,
    }));
  const latestTest = tests.get(provider.id);
  return {
    id: provider.id,
    displayName: provider.displayName,
    protocol: provider.protocol,
    rootUrl: provider.rootUrl,
    apiBaseUrl: provider.rootUrl,
    hasApiKey,
    imported,
    modelCount: models.filter((model) => belongsToProvider(model, provider))
      .length,
    ...(latestTest === undefined ? {} : { latestTest }),
    ...(modelTests.length === 0 ? {} : { modelTests }),
  };
}

function belongsToProvider(
  row: DaemonCustomModelRow,
  provider: ProviderConnection,
): boolean {
  return (
    row.provider === provider.protocol &&
    (sameProviderEndpoint(row.baseUrl, provider.rootUrl) ||
      sameProviderEndpoint(row.baseUrl, provider.apiBaseUrl))
  );
}

function rememberTest(
  ctl: CustomModelsHost,
  providerId: string,
  model: string,
  result: {
    readonly status: 'passed' | 'failed';
    readonly summary: string;
    readonly latencyMs: number;
  },
): void {
  ctl.providerTests.set(providerId, result);
  ctl.providerTests.set(`${providerId}\u0000${model}`, result);
}

function resolveConnection(
  ctl: CustomModelsHost,
  providerId: string,
): ProviderConnection | null {
  return (
    ctl.providerRegistry?.get(providerId) ??
    importedProviders(ctl).get(providerId) ??
    null
  );
}

function importedProviders(
  ctl: CustomModelsHost,
): Map<string, ProviderConnection> {
  const existing = importedByHost.get(ctl);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, ProviderConnection>();
  importedByHost.set(ctl, created);
  return created;
}

async function readProviderKey(
  ctl: CustomModelsHost,
  provider: ProviderConnection,
): Promise<string | undefined> {
  if (ctl.providerRegistry === undefined) {
    return undefined;
  }
  if (ctl.providerRegistry.get(provider.id) !== null) {
    return ctl.providerRegistry.apiKey(provider.id);
  }
  return undefined;
}

async function requireProviderKey(
  ctl: CustomModelsHost,
  provider: ProviderConnection,
): Promise<string | undefined> {
  const stored = await readProviderKey(ctl, provider);
  if (stored !== undefined) {
    return stored;
  }
  const typed = await ctl.promptProviderApiKey?.();
  if (typed === undefined || typed.length === 0) {
    return undefined;
  }
  if (ctl.providerRegistry?.get(provider.id) != null) {
    await ctl.providerRegistry.save({
      id: provider.id,
      displayName: provider.displayName,
      protocol: provider.protocol,
      rootUrl: provider.rootUrl,
      apiKey: typed,
    });
  }
  return typed;
}

function emitProviderModels(
  ctl: CustomModelsHost,
  sessionId: string,
  providers: ProviderModelsState,
): void {
  ctl.emit({ type: 'providerModels.state', sessionId, providers });
}

function emitModels(
  ctl: CustomModelsHost,
  sessionId: string,
  customModels: CustomModelsState,
): void {
  ctl.emit({ type: 'customModels.state', sessionId, customModels });
}

function emitDiscovery(
  ctl: CustomModelsHost,
  sessionId: string,
  discovery: CustomModelDiscoveryState,
): void {
  ctl.emit({ type: 'customModels.discovery', sessionId, discovery });
}
