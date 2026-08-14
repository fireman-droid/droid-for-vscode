// Host-side tests for the BYOK custom-models handlers
// (src/extension/chat/customModels.ts). Gateway shapes mirror the
// probed daemon behavior (artifacts/probe-custom-models-daemon.mjs,
// 2026-08-13): list returns masked rows, upsert/delete answer with
// the fresh models array, and stale expectedModel guards reject with
// "Custom models changed on disk; refresh and try again".
import { describe, expect, it, vi } from 'vitest';

import {
  createController,
  createMockRuntime,
  DaemonAvailabilityError,
  ready,
  waitForConnected,
  type RuntimeDiagnosticSink,
} from './controllerTestHarness';
import {
  CUSTOM_MODELS_BUSY_MESSAGE,
  CUSTOM_MODELS_CONFLICT_MESSAGE,
  CUSTOM_MODELS_DISCOVERY_UNAVAILABLE_MESSAGE,
  CUSTOM_MODELS_IMPORT_FAILED_MESSAGE,
  CUSTOM_MODELS_LOAD_FAILED_MESSAGE,
  CUSTOM_MODELS_NOT_LOGGED_IN_MESSAGE,
  CUSTOM_MODELS_SAVE_FAILED_MESSAGE,
  CUSTOM_MODELS_UNAVAILABLE_MESSAGE,
  dispatchCustomModels,
  handleCustomModelSave,
  handleCustomModelsDiscover,
  handleCustomModelsImport,
  handleCustomModelsRefresh,
  projectCustomModelItems,
  type CustomModelsGateway,
  type CustomModelsHost,
  type DaemonCustomModelRow,
} from './chat/customModels';
import {
  ModelDiscoveryError,
  type CustomModelDiscoveryGateway,
} from './chat/modelDiscovery';
import type {
  CustomModelsDiscoveryStateMessage,
  CustomModelsStateMessage,
} from '../shared/customModelsProtocol';
import { resetSessionMetadata } from './chat/runtimeLifecycle';

/** One masked row exactly as the probe captured it. */
function probeRow(
  overrides: Partial<DaemonCustomModelRow> = {},
): DaemonCustomModelRow {
  return {
    rawIndex: 0,
    model: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    provider: 'openai',
    baseUrl: 'http://38.47.121.18:8080',
    hasApiKey: true,
    apiKeyMask: '••••c752',
    maxOutputTokens: 16384,
    noImageSupport: false,
    hasBedrockConfig: false,
    isValid: true,
    ...overrides,
  };
}

function createGateway() {
  return {
    list: vi.fn<CustomModelsGateway['list']>(async () => [probeRow()]),
    upsert: vi.fn<CustomModelsGateway['upsert']>(async () => ({
      success: true,
      models: [probeRow(), probeRow({ rawIndex: 1, model: 'qwen3:4b' })],
    })),
    delete: vi.fn<CustomModelsGateway['delete']>(async () => ({
      success: true,
      models: [probeRow()],
    })),
  } satisfies CustomModelsGateway;
}

function customModelsMessages(
  messages: readonly unknown[],
): CustomModelsStateMessage[] {
  return messages.filter(
    (message): message is CustomModelsStateMessage =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'customModels.state',
  );
}

function discoveryMessages(
  messages: readonly unknown[],
): CustomModelsDiscoveryStateMessage[] {
  return messages.filter(
    (message): message is CustomModelsDiscoveryStateMessage =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'customModels.discovery',
  );
}

async function connectedHost(options: {
  gateway?: CustomModelsGateway | null;
  discovery?: CustomModelDiscoveryGateway;
  diagnostics?: RuntimeDiagnosticSink;
} = {}) {
  const runtime = createMockRuntime();
  const { controller, messages } = createController(
    () => runtime,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.diagnostics,
  );
  ready(controller);
  await waitForConnected(messages);
  const host = controller as unknown as CustomModelsHost;
  host.customModelsOp = false;
  if (options.gateway !== null) {
    const gateway = options.gateway ?? createGateway();
    host.daemonCustomModels = async () => gateway;
  }
  host.modelDiscovery = options.discovery;
  return { host, controller, messages, runtime };
}

const saveMessage = {
  type: 'customModels.save',
  sessionId: 'session-1',
  model: 'qwen3:4b',
  displayName: 'Qwen 3',
  provider: 'generic-chat-completion-api',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'sk-plaintext-test-key-12345',
  maxOutputTokens: null,
  noImageSupport: false,
} as const;

const importMessage = {
  type: 'customModels.import',
  sessionId: 'session-1',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'import-key-for-test',
  models: [
    { model: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
    { model: 'model-new', displayName: 'Model New' },
  ],
  maxOutputTokens: 8192,
  noImageSupport: false,
} as const;

describe('ChatController custom models', () => {
  it('lists on refresh: loading then masked ready items', async () => {
    const gateway = createGateway();
    const { host, messages } = await connectedHost({ gateway });

    handleCustomModelsRefresh(host, 'session-1');
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'ready',
        items: [{ model: 'gpt-5.6-luna', apiKeyMask: '••••c752' }],
      });
    });
    expect(
      customModelsMessages(messages)[0]?.customModels.status,
    ).toBe('loading');
    expect(gateway.list).toHaveBeenCalledTimes(1);
  });

  it('dispatches the panel messages through handleMessage', async () => {
    const gateway = createGateway();
    const { host, controller, messages } = await connectedHost({
      gateway,
    });
    void host;
    controller.handleMessage({
      type: 'customModels.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    expect(gateway.list).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable without a daemon gateway', async () => {
    const { host, messages } = await connectedHost({ gateway: null });
    handleCustomModelsRefresh(host, 'session-1');
    expect(
      customModelsMessages(messages).at(-1)?.customModels,
    ).toMatchObject({
      status: 'unavailable',
      message: CUSTOM_MODELS_UNAVAILABLE_MESSAGE,
    });
  });

  it('drops requests for a mismatched session silently', async () => {
    const gateway = createGateway();
    const { host, messages } = await connectedHost({ gateway });
    handleCustomModelsRefresh(host, 'session-other');
    dispatchCustomModels(host, {
      type: 'customModels.delete',
      sessionId: 'session-other',
      rawIndex: 0,
      expectedModel: 'gpt-5.6-luna',
    });
    expect(customModelsMessages(messages)).toHaveLength(0);
    expect(gateway.list).not.toHaveBeenCalled();
    expect(gateway.delete).not.toHaveBeenCalled();
  });

  it('discovers models through the Host and never echoes the key', async () => {
    const discovery = {
      discover: vi.fn<CustomModelDiscoveryGateway['discover']>(async () => [
        { model: 'model-a', displayName: 'Model A' },
      ]),
    };
    const { controller, messages } = await connectedHost({ discovery });
    controller.handleMessage({
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'discovery-key-for-test',
    });
    await vi.waitFor(() => {
      expect(
        discoveryMessages(messages).at(-1)?.discovery.status,
      ).toBe('ready');
    });
    expect(discoveryMessages(messages)[0]?.discovery.status).toBe('loading');
    expect(discovery.discover).toHaveBeenCalledWith(
      {
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'discovery-key-for-test',
      },
      expect.anything(),
    );
    expect(JSON.stringify(messages)).not.toContain('discovery-key-for-test');
  });

  it('reports unavailable discovery and ignores stale results', async () => {
    const unavailable = await connectedHost();
    handleCustomModelsDiscover(unavailable.host, {
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
    });
    expect(
      discoveryMessages(unavailable.messages).at(-1)?.discovery,
    ).toMatchObject({
      status: 'error',
      message: CUSTOM_MODELS_DISCOVERY_UNAVAILABLE_MESSAGE,
    });

    let resolveDiscovery: (
      items: readonly { model: string }[],
    ) => void = () => {};
    const discovery = {
      discover: vi.fn<CustomModelDiscoveryGateway['discover']>(
        () =>
          new Promise((resolve) => {
            resolveDiscovery = resolve;
          }),
      ),
    };
    const pending = await connectedHost({ discovery });
    handleCustomModelsDiscover(pending.host, {
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
    });
    pending.host.runtimeGeneration += 1;
    resolveDiscovery([{ model: 'stale-model' }]);
    await vi.waitFor(() => {
      expect(pending.host.customModelsOp).toBe(false);
    });
    expect(discoveryMessages(pending.messages)).toHaveLength(1);
  });

  it('cancels stale discovery without clearing the next operation', async () => {
    const discovery = {
      discover: vi.fn<CustomModelDiscoveryGateway['discover']>(
        (_, signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new ModelDiscoveryError('aborted')),
            );
          }),
      ),
    };
    let releaseList: (rows: DaemonCustomModelRow[]) => void = () => {};
    const gateway = createGateway();
    gateway.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseList = resolve;
        }),
    );
    const { host, messages } = await connectedHost({ discovery, gateway });
    handleCustomModelsDiscover(host, {
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
    });
    resetSessionMetadata(host);
    handleCustomModelsRefresh(host, 'session-1');
    await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(1));
    expect(host.customModelsOp).toBe(true);
    releaseList([probeRow()]);
    await vi.waitFor(() => {
      expect(customModelsMessages(messages).at(-1)?.customModels.status).toBe(
        'ready',
      );
    });
  });

  it.each([
    [
      new ModelDiscoveryError('http', 401),
      'The provider rejected this key.',
    ],
    [
      new ModelDiscoveryError('http', 404),
      'No model catalog was found',
    ],
    [
      new ModelDiscoveryError('timed-out'),
      'The provider took too long',
    ],
    [
      new ModelDiscoveryError('response-too-large'),
      'unsupported model catalog',
    ],
  ])('maps discovery failures to fixed copy', async (failure, copy) => {
    const discovery = {
      discover: vi.fn<CustomModelDiscoveryGateway['discover']>(async () => {
        throw failure;
      }),
    };
    const { host, messages } = await connectedHost({ discovery });
    handleCustomModelsDiscover(host, {
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
    });
    await vi.waitFor(() => {
      expect(
        discoveryMessages(messages).at(-1)?.discovery,
      ).toMatchObject({ status: 'error', message: expect.stringContaining(copy) });
    });
  });

  it('keeps discovery credentials and upstream errors out of diagnostics', async () => {
    const events: unknown[] = [];
    const discovery = {
      discover: vi.fn<CustomModelDiscoveryGateway['discover']>(async () => {
        throw new Error('credential-for-test from upstream');
      }),
    };
    const { host, messages } = await connectedHost({
      discovery,
      diagnostics: { record: (event) => events.push(event) },
    });
    handleCustomModelsDiscover(host, {
      type: 'customModels.discover',
      sessionId: 'session-1',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'credential-for-test',
    });
    await vi.waitFor(() => {
      expect(discoveryMessages(messages).at(-1)?.discovery.status).toBe(
        'error',
      );
    });
    expect(JSON.stringify(messages)).not.toContain('credential-for-test');
    expect(JSON.stringify(events)).not.toContain('credential-for-test');
  });

  it('imports selected models sequentially and skips configured IDs', async () => {
    const gateway = createGateway();
    const configured = probeRow({
      baseUrl: 'https://api.example.com/v1',
      apiKeyMask: '••••test',
      maxOutputTokens: 8192,
    });
    gateway.list.mockResolvedValue([configured]);
    gateway.upsert.mockImplementation(async (params) => ({
      success: true,
      models: [
        configured,
        probeRow({
          rawIndex: 1,
          model: params.model,
          displayName: params.displayName,
        }),
      ],
    }));
    const { controller, messages } = await connectedHost({ gateway });
    controller.handleMessage(importMessage);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    expect(gateway.upsert).toHaveBeenCalledTimes(1);
    expect(gateway.upsert).toHaveBeenCalledWith({
      model: 'model-new',
      displayName: 'Model New',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'import-key-for-test',
      maxOutputTokens: 8192,
      noImageSupport: false,
    });
    expect(JSON.stringify(messages)).not.toContain('import-key-for-test');
  });

  it('does not assume an unmasked stored key matches the import key', async () => {
    const gateway = createGateway();
    gateway.list.mockResolvedValue([
      probeRow({
        baseUrl: 'https://api.example.com/v1',
        apiKeyMask: undefined,
        maxOutputTokens: 8192,
      }),
    ]);
    const { host } = await connectedHost({ gateway });
    handleCustomModelsImport(host, {
      ...importMessage,
      models: [{ model: 'gpt-5.6-luna' }],
    });
    await vi.waitFor(() => {
      expect(gateway.upsert).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves successful rows after a partial import failure', async () => {
    const gateway = createGateway();
    gateway.list.mockResolvedValue([]);
    gateway.upsert
      .mockResolvedValueOnce({
        success: true,
        models: [
          probeRow({
            model: 'model-first',
            displayName: 'Model First',
          }),
        ],
      })
      .mockRejectedValueOnce(new Error('credential-bearing detail'));
    const { host, messages } = await connectedHost({ gateway });
    handleCustomModelsImport(host, {
      ...importMessage,
      models: [{ model: 'model-first' }, { model: 'model-second' }],
    });
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'error',
        items: [{ model: 'model-first' }],
        message: CUSTOM_MODELS_IMPORT_FAILED_MESSAGE,
      });
    });
    expect(gateway.upsert).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(messages)).not.toContain('credential-bearing detail');
    expect(JSON.stringify(messages)).not.toContain('import-key-for-test');
  });

  it('saves through one upsert handoff and never echoes the key', async () => {
    const gateway = createGateway();
    const { host, messages } = await connectedHost({ gateway });

    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    expect(gateway.upsert).toHaveBeenCalledWith({
      model: 'qwen3:4b',
      displayName: 'Qwen 3',
      provider: 'generic-chat-completion-api',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-plaintext-test-key-12345',
      maxOutputTokens: null,
      noImageSupport: false,
    });
    // Credential red line: the plaintext key exists only on the
    // inbound message -> upsert params handoff; no emitted Bridge
    // message may carry it (masks are fine).
    expect(JSON.stringify(messages)).not.toContain(
      'sk-plaintext-test-key-12345',
    );
  });

  it('edits with the concurrency pair and omits an absent key', async () => {
    const gateway = createGateway();
    const { host, messages } = await connectedHost({ gateway });

    const { apiKey: _apiKey, displayName: _dn, ...rest } = saveMessage;
    handleCustomModelSave(host, {
      ...rest,
      rawIndex: 1,
      expectedModel: 'qwen3:4b',
      maxOutputTokens: 16384,
      noImageSupport: true,
    });
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    const params = gateway.upsert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(params).toMatchObject({
      rawIndex: 1,
      expectedModel: 'qwen3:4b',
      maxOutputTokens: 16384,
      noImageSupport: true,
    });
    expect('apiKey' in params).toBe(false);
    expect('displayName' in params).toBe(false);
  });

  it('deletes with the guard pair and broadcasts the fresh list', async () => {
    const gateway = createGateway();
    const { host, messages } = await connectedHost({ gateway });

    dispatchCustomModels(host, {
      type: 'customModels.delete',
      sessionId: 'session-1',
      rawIndex: 1,
      expectedModel: 'qwen3:4b',
    });
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'ready',
        items: [{ model: 'gpt-5.6-luna' }],
      });
    });
    expect(gateway.delete).toHaveBeenCalledWith({
      rawIndex: 1,
      expectedModel: 'qwen3:4b',
    });
  });

  it('maps the probed conflict error and re-lists automatically', async () => {
    const gateway = createGateway();
    gateway.upsert.mockImplementation(async () => {
      throw new Error(
        'RPC Error: Custom models changed on disk; refresh and try again',
      );
    });
    const { host, messages } = await connectedHost({ gateway });

    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).some(
          (message) =>
            message.customModels.status === 'error' &&
            message.customModels.message ===
              CUSTOM_MODELS_CONFLICT_MESSAGE,
        ),
      ).toBe(true);
    });
    // The conflict path converges the panel on the daemon's truth.
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    expect(gateway.list).toHaveBeenCalled();
  });

  it('maps unknown save failures to fixed copy, not raw errors', async () => {
    const gateway = createGateway();
    gateway.upsert.mockImplementation(async () => {
      throw new Error('secret-bearing upstream detail');
    });
    const { host, messages } = await connectedHost({ gateway });

    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'error',
        message: CUSTOM_MODELS_SAVE_FAILED_MESSAGE,
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'secret-bearing upstream detail',
    );
  });

  it('treats a resolved unsuccessful daemon mutation as a failure', async () => {
    const gateway = createGateway();
    gateway.upsert.mockResolvedValue({
      success: false,
      models: [probeRow()],
    });
    const { host, messages } = await connectedHost({ gateway });
    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(customModelsMessages(messages).at(-1)?.customModels).toMatchObject({
        status: 'error',
        message: CUSTOM_MODELS_SAVE_FAILED_MESSAGE,
      });
    });
  });

  it('maps a signed-out daemon to the login hint', async () => {
    const { host, messages } = await connectedHost({ gateway: null });
    host.daemonCustomModels = async () => {
      throw new DaemonAvailabilityError(
        'not-logged-in',
        'Daemon requires login',
      );
    };
    handleCustomModelsRefreshTwiceSafe(host);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'error',
        message: CUSTOM_MODELS_NOT_LOGGED_IN_MESSAGE,
      });
    });
  });

  it('rejects a second mutation while one is in flight', async () => {
    let releaseList: (rows: DaemonCustomModelRow[]) => void = () => {};
    const gateway = createGateway();
    gateway.list.mockImplementation(
      () =>
        new Promise<DaemonCustomModelRow[]>((resolve) => {
          releaseList = resolve;
        }),
    );
    const { host, messages } = await connectedHost({ gateway });

    handleCustomModelsRefresh(host, 'session-1');
    handleCustomModelSave(host, saveMessage);
    expect(
      customModelsMessages(messages).at(-1)?.customModels,
    ).toMatchObject({
      status: 'error',
      message: CUSTOM_MODELS_BUSY_MESSAGE,
    });
    expect(gateway.upsert).not.toHaveBeenCalled();

    // The deferred resolver only exists once the async chain invoked
    // list(); release after that point, not before.
    await vi.waitFor(() => {
      expect(gateway.list).toHaveBeenCalled();
    });
    releaseList([probeRow()]);
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels.status,
      ).toBe('ready');
    });
    // The flag clears with the round-trip; the next save proceeds.
    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(gateway.upsert).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces list failures with fixed copy', async () => {
    const gateway = createGateway();
    gateway.list.mockImplementation(async () => {
      throw new Error('boom');
    });
    const { host, messages } = await connectedHost({ gateway });
    handleCustomModelsRefresh(host, 'session-1');
    await vi.waitFor(() => {
      expect(
        customModelsMessages(messages).at(-1)?.customModels,
      ).toMatchObject({
        status: 'error',
        message: CUSTOM_MODELS_LOAD_FAILED_MESSAGE,
      });
    });
  });

  it('reloads an idle session after a save so the catalog refreshes', async () => {
    const events: string[] = [];
    const diagnostics: RuntimeDiagnosticSink = {
      record: (event) => {
        events.push(event.name);
      },
    };
    const { host, runtime } = await connectedHost({ diagnostics });

    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(events).toContain('host.customModels.reload');
    });
    // The in-place resume re-initializes the runtime, which is what
    // re-captures availableModels for the model picker.
    await vi.waitFor(() => {
      expect(runtime.initialize.mock.calls.length).toBeGreaterThan(1);
    });
    expect(events).not.toContain('host.customModels.reload-skipped');
  });

  it('skips the reload while a turn is active', async () => {
    const events: string[] = [];
    const diagnostics: RuntimeDiagnosticSink = {
      record: (event) => {
        events.push(event.name);
      },
    };
    const runtime = createMockRuntime(async function* () {
      await new Promise(() => {});
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      diagnostics,
    );
    ready(controller);
    await waitForConnected(messages);
    const host = controller as unknown as CustomModelsHost;
    host.customModelsOp = false;
    host.daemonCustomModels = async () => createGateway();

    controller.handleMessage({
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'keep running',
    });
    handleCustomModelSave(host, saveMessage);
    await vi.waitFor(() => {
      expect(events).toContain('host.customModels.reload-skipped');
    });
    expect(events).not.toContain('host.customModels.reload');
  });
});

/** Refresh via the same guard chain used by the panel's retry. */
function handleCustomModelsRefreshTwiceSafe(host: CustomModelsHost): void {
  handleCustomModelsRefresh(host, 'session-1');
}

describe('projectCustomModelItems', () => {
  it('projects probe-shaped rows faithfully', () => {
    expect(projectCustomModelItems([probeRow()])).toEqual([
      {
        rawIndex: 0,
        model: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        provider: 'openai',
        baseUrl: 'http://38.47.121.18:8080',
        hasApiKey: true,
        apiKeyMask: '••••c752',
        maxOutputTokens: 16384,
        noImageSupport: false,
        hasBedrockConfig: false,
        isValid: true,
      },
    ]);
  });

  it('drops hostile rows instead of inventing values', () => {
    expect(
      projectCustomModelItems([
        probeRow({ model: 'bad\u0000model' }),
        probeRow({ rawIndex: -1 }),
        probeRow({ rawIndex: 2, model: ' padded ' }),
        probeRow({ rawIndex: 3, maxOutputTokens: -5 }),
      ]),
    ).toEqual([]);
  });

  it('drops duplicate rawIndex rows after the first', () => {
    const items = projectCustomModelItems([
      probeRow(),
      probeRow({ model: 'other-model' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.model).toBe('gpt-5.6-luna');
  });

  it('keeps Bedrock and invalid flags for quiet badges', () => {
    const items = projectCustomModelItems([
      probeRow({ hasBedrockConfig: true, isValid: false }),
    ]);
    expect(items[0]).toMatchObject({
      hasBedrockConfig: true,
      isValid: false,
    });
  });
});
