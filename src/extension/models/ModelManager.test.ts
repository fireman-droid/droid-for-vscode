import { describe, expect, it, vi } from 'vitest';
import { ModelDiscoveryError } from '../chat/models/modelDiscovery';
import { ProviderRegistry } from '../chat/models/providerRegistry';
import type {
  ModelManagementGateway,
  SavedModel,
} from '../../runtime/models/modelManagement';
import { ModelManager, modelManagerFailure } from './ModelManager';
import { findLoadedModel } from './modelProjection';
import {
  parseModelsRequest,
  MODEL_MANAGER_VERSION,
} from '../../shared/protocol/modelManagerProtocol';

const row: SavedModel = {
  rawIndex: 0,
  model: 'upstream-one',
  displayName: 'One · Gateway',
  provider: 'openai',
  baseUrl: 'https://gateway.example.com/v1',
  hasApiKey: true,
  hasBedrockConfig: false,
  isValid: true,
  maxOutputTokens: 4096,
  noImageSupport: true,
};
function fixture() {
  const store = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const registry = new ProviderRegistry(
    {
      get: <T>(key: string) => store.get(key) as T | undefined,
      update: async (key, value) => {
        store.set(key, value);
      },
    },
    {
      get: async (key) => secrets.get(key),
      store: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
  );
  const gateway = {
    list: vi.fn(async () => [row]),
    loaded: vi.fn(async () => [
      {
        id: 'actual-droid-id',
        displayName: row.displayName!,
        provider: row.provider,
        disabledReason: null,
      },
    ]),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    verify: vi.fn(async () => ({
      status: 'passed' as const,
      message: 'Completed',
      latencyMs: 10,
    })),
  } satisfies ModelManagementGateway;
  const apply = vi.fn(async () => {});
  const readApplyState = vi.fn(() => ({
    activeModelId: null,
    canApply: true,
    message: 'Ready',
  }));
  const manager = new ModelManager({
    gateway,
    registry,
    apply,
    readApplyState,
    promptKey: async () => "fixture-key",
    discovery: { discover: async () => [] },
  });
  return { manager, gateway, registry, apply, readApplyState };
}

describe('independent model management', () => {
  it('holds operation ownership until the connection and every model write settle', async () => {
    const { manager, gateway } = fixture();
    const connectionId = (await manager.snapshot()).connections[0]!.id;
    let finish!: () => void;
    gateway.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = manager.execute(
      {
        kind: 'saveConnection',
        draft: {
          id: connectionId,
          name: 'Gateway',
          protocol: 'openai',
          baseUrl: 'https://gateway.example.com/v2',
          setApiKey: true,
        },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(gateway.save).toHaveBeenCalledTimes(1));
    await expect(
      manager.execute({ kind: 'refresh' }, new AbortController().signal),
    ).rejects.toThrow('still running');
    expect(gateway.save).toHaveBeenCalledWith(
      expect.objectContaining({
        rawIndex: 0,
        expectedModel: row.model,
        displayName: row.displayName,
        maxOutputTokens: 4096,
        noImageSupport: true,
        baseUrl: 'https://gateway.example.com/v2',
      }),
    );
    finish();
    await saving;
    await expect(
      manager.execute({ kind: 'refresh' }, new AbortController().signal),
    ).resolves.toBeDefined();
  });

  it('rejects ambiguous names, mismatched protocols and stale edited identifiers', async () => {
    const { manager, gateway } = fixture();
    const loaded = await gateway.loaded();
    expect(
      findLoadedModel(row, loaded, [row, { ...row, rawIndex: 1 }]).runtimeId,
    ).toBeNull();
    expect(
      findLoadedModel(row, [{ ...loaded[0]!, provider: 'anthropic' }], [row]).runtimeId,
    ).toBeNull();
    await expect(
      manager.execute(
        { kind: 'verifyModel', rawIndex: 0, expectedModel: 'edited-but-unsaved' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('changed elsewhere');
    expect(gateway.verify).not.toHaveBeenCalled();
  });

  it('verifies the daemon-returned ID, keeps its result, and does not apply to a busy chat', async () => {
    const { manager, gateway, readApplyState, apply } = fixture();
    await manager.execute(
      { kind: 'verifyModel', rawIndex: 0, expectedModel: row.model },
      new AbortController().signal,
    );
    expect(gateway.verify).toHaveBeenCalledWith(
      'actual-droid-id',
      expect.any(AbortSignal),
    );
    expect((await manager.snapshot()).models[0]?.test?.status).toBe('passed');
    readApplyState.mockReturnValue({
      activeModelId: null,
      canApply: false,
      message: 'Queue is busy',
    });
    await expect(
      manager.execute(
        { kind: 'useModel', rawIndex: 0, expectedModel: row.model },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Queue is busy');
    expect(apply).not.toHaveBeenCalled();
  });

  it('preserves typed endpoint paths and reports partial import progress without upstream bodies', async () => {
    const { manager, registry, gateway } = fixture();
    await registry.save({
      displayName: 'Root',
      protocol: 'openai',
      rootUrl: 'https://gateway.example.com',
    });
    const connection = await registry.save({
      displayName: 'Versioned',
      protocol: 'openai',
      rootUrl: row.baseUrl!,
    });
    gateway.save
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('401 private response body'));
    await expect(
      manager.execute(
        {
          kind: 'importModels',
          connectionId: connection.id,
          models: [{ model: 'new-one' }, { model: 'new-two' }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('1 models saved before import stopped. Authentication failed.');
    expect(modelManagerFailure(new Error('401 private response body'))).not.toContain(
      'private response',
    );
  });

  it('rejects plaintext keys and partial edit identities at the panel boundary', () => {
    const request = {
      type: 'models.request',
      version: MODEL_MANAGER_VERSION,
      requestId: 'one',
      action: {
        kind: 'saveModel',
        draft: {
          connectionId: 'gateway',
          model: 'exact-id',
          displayName: '',
          maxOutputTokens: null,
          noImageSupport: false,
        },
      },
    };
    expect(parseModelsRequest(request)).toEqual(request);
    expect(
      parseModelsRequest({
        ...request,
        action: {
          ...request.action,
          draft: { ...request.action.draft, apiKey: 'must-not-cross' },
        },
      }),
    ).toBeUndefined();
    expect(
      parseModelsRequest({
        ...request,
        action: { ...request.action, draft: { ...request.action.draft, rawIndex: 0 } },
      }),
    ).toBeUndefined();
  });

  it('reuses saved SecretStorage credentials on discover without re-prompting and does not loop on 401', async () => {
    const { gateway, registry, apply, readApplyState } = fixture();
    const promptKey = vi.fn(async () => '  sk-remembered-once  ');
    const discover = vi.fn(async () => [{ model: 'discovered-a', displayName: 'Discovered A' }]);
    const manager = new ModelManager({
      gateway,
      registry,
      apply,
      readApplyState,
      promptKey,
      discovery: { discover },
    });
    const connectionId = (await manager.snapshot()).connections[0]!.id;

    // First discover on a Droid-imported connection (no SecretStorage key yet) prompts once and trims.
    await manager.execute(
      { kind: 'discover', connectionId },
      new AbortController().signal,
    );
    expect(promptKey).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenLastCalledWith(
      {
        provider: 'openai',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'sk-remembered-once',
      },
      expect.any(AbortSignal),
    );

    // Subsequent discover on the same connection reuses SecretStorage without prompting again.
    await manager.execute(
      { kind: 'discover', connectionId },
      new AbortController().signal,
    );
    expect(promptKey).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledTimes(2);

    // A 401 or network failure reports the error without clearing the saved key or re-prompting.
    discover.mockRejectedValueOnce(new ModelDiscoveryError('http', 401));
    await expect(
      manager.execute(
        { kind: 'discover', connectionId },
        new AbortController().signal,
      ),
    ).rejects.toThrow(ModelDiscoveryError);
    expect(promptKey).toHaveBeenCalledTimes(1);
    await expect(
      registry.apiKeyForEndpoint('openai', 'https://gateway.example.com/v1'),
    ).resolves.toBe('sk-remembered-once');
  });

  it('deduplicates same-connection key prompts, allows independent connection discovery, and never writes cancelled keys', async () => {
    const { gateway, registry, apply, readApplyState } = fixture();
    const connA = await registry.save({
      displayName: 'Alpha',
      protocol: 'openai',
      rootUrl: 'https://alpha.example.com/v1',
    });
    const connB = await registry.save({
      displayName: 'Beta',
      protocol: 'anthropic',
      rootUrl: 'https://beta.example.com/v1',
      apiKey: 'sk-beta-saved',
    });
    gateway.list.mockResolvedValue([
      { ...row, rawIndex: 0, provider: 'openai', baseUrl: connA.rootUrl, hasApiKey: true },
      { ...row, rawIndex: 1, provider: 'anthropic', baseUrl: connB.rootUrl, hasApiKey: true },
    ]);

    let resolvePromptA!: (value: string | undefined) => void;
    const promptKey = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolvePromptA = resolve;
        }),
    );
    const discover = vi.fn(async ({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) => [
      { model: `${new URL(baseUrl).hostname}:${apiKey ?? 'none'}` },
    ]);
    const manager = new ModelManager({
      gateway,
      registry,
      apply,
      readApplyState,
      promptKey,
      discovery: { discover },
    });

    const firstA = manager.execute(
      { kind: 'discover', connectionId: connA.id },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(promptKey).toHaveBeenCalledTimes(1));

    // Duplicate click on the same connection is rejected while in flight without opening a second prompt.
    await expect(
      manager.execute(
        { kind: 'discover', connectionId: connA.id },
        new AbortController().signal,
      ),
    ).rejects.toThrow('still running');
    expect(promptKey).toHaveBeenCalledTimes(1);

    // Concurrent registry prompt for the same endpoint shares the single in-flight prompt.
    const sharedPrompt = registry.promptApiKey('openai', connA.rootUrl, promptKey);
    expect(promptKey).toHaveBeenCalledTimes(1);

    // Another connection with its own saved key can discover without waiting for connA's prompt.
    const resultB = await manager.execute(
      { kind: 'discover', connectionId: connB.id },
      new AbortController().signal,
    );
    expect(resultB.discovered).toEqual([{ model: 'beta.example.com:sk-beta-saved' }]);
    expect(promptKey).toHaveBeenCalledTimes(1);

    // Cancelling the prompt writes nothing and does not overwrite other connections.
    resolvePromptA('   ');
    await expect(firstA).rejects.toThrow('API key entry cancelled');
    await expect(sharedPrompt).resolves.toBeUndefined();
    await expect(registry.apiKeyForEndpoint('openai', connA.rootUrl)).resolves.toBeUndefined();
    await expect(registry.apiKeyForEndpoint('anthropic', connB.rootUrl)).resolves.toBe('sk-beta-saved');
  });

  it('keeps the single-flight slot across deferred SecretStorage persistence and cleans up after store failure or cancellation', async () => {
    const storeMap = new Map<string, unknown>();
    const secretsMap = new Map<string, string>();
    let finishStore: (() => void) | undefined;
    let rejectStore: ((error: Error) => void) | undefined;
    const storeSpy = vi.fn(
      (key: string, value: string) =>
        new Promise<void>((resolve, reject) => {
          finishStore = () => {
            secretsMap.set(key, value);
            resolve();
          };
          rejectStore = reject;
        }),
    );
    const customRegistry = new ProviderRegistry(
      {
        get: <T>(key: string) => storeMap.get(key) as T | undefined,
        update: async (key, value) => {
          storeMap.set(key, value);
        },
      },
      {
        get: async (key) => secretsMap.get(key),
        store: storeSpy,
        delete: async (key) => {
          secretsMap.delete(key);
        },
      },
    );

    const promptSpy = vi.fn(async () => 'sk-deferred-persist');
    const abortFirst = new AbortController();

    // First call resolves promptKey immediately, then pauses inside secrets.store.
    const first = customRegistry.promptApiKey(
      'openai',
      'https://deferred.example.com/v1',
      promptSpy,
      { signal: abortFirst.signal },
    );
    await vi.waitFor(() => expect(storeSpy).toHaveBeenCalledTimes(1));
    expect(promptSpy).toHaveBeenCalledTimes(1);

    // Second call arrives while secrets.store is still pending (secrets.get still undefined):
    // must join the existing single-flight slot instead of prompting or storing again.
    const second = customRegistry.promptApiKey(
      'openai',
      'https://deferred.example.com/v1/',
      promptSpy,
    );
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledTimes(1);

    // Aborting the first waiter while store is pending rejects only the first waiter.
    abortFirst.abort();
    await expect(first).rejects.toThrow();
    finishStore!();
    await expect(second).resolves.toBe('sk-deferred-persist');
    await expect(
      customRegistry.apiKeyForEndpoint('openai', 'https://deferred.example.com/v1'),
    ).resolves.toBe('sk-deferred-persist');

    // Store failure on another endpoint surfaces the error and clears the slot so retry can proceed.
    const failPrompt = vi.fn(async () => 'sk-store-fail');
    const failing = customRegistry.promptApiKey(
      'anthropic',
      'https://fail.example.com/v1',
      failPrompt,
    );
    await vi.waitFor(() => expect(storeSpy).toHaveBeenCalledTimes(2));
    rejectStore!(new Error('secret-store-unavailable'));
    await expect(failing).rejects.toThrow('secret-store-unavailable');

    const retry = customRegistry.promptApiKey(
      'anthropic',
      'https://fail.example.com/v1',
      failPrompt,
    );
    await vi.waitFor(() => expect(storeSpy).toHaveBeenCalledTimes(3));
    finishStore!();
    await expect(retry).resolves.toBe('sk-store-fail');
  });
});
