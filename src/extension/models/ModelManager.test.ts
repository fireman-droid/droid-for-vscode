import { describe, expect, it, vi } from 'vitest';
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
    promptKey: async () => undefined,
    discovery: { discover: async () => [] },
  });
  return { manager, gateway, registry, apply, readApplyState };
}

describe('independent model management', () => {
  it('holds operation ownership until the connection and every model write settle', async () => {
    const { manager, gateway } = fixture();
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
          id: 'imported:0',
          name: 'Gateway',
          protocol: 'openai',
          baseUrl: 'https://gateway.example.com/v2',
          setApiKey: false,
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
});
