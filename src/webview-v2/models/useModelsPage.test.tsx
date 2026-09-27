// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MODEL_MANAGER_VERSION,
  type ManagedModel,
  type ModelsHostMessage,
  type ModelsRequest,
  type ModelsSnapshot,
} from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from './useModels';
import { useModelsPage } from './useModelsPage';

afterEach(cleanup);

const catalog = ['alpha', 'beta', 'gamma'].map((model) => ({ model }));

function savedModel(model: string, connectionId = 'first'): ManagedModel {
  return {
    rawIndex: 0, model, displayName: model, connectionId, maxOutputTokens: null,
    noImageSupport: false, valid: true, runtimeId: `loaded:${model}`,
    loadMessage: 'Loaded by Droid', test: null,
  };
}

function createHost() {
  let snapshot: ModelsSnapshot = {
    connections: ['first', 'second'].map((id) => ({
      id, name: id, protocol: 'generic-chat-completion-api' as const,
      baseUrl: `https://${id}.example.com/v1`, hasKey: true, imported: false,
    })),
    models: [], activeModelId: null, canApply: true, applyMessage: 'Idle',
  };
  const requests: ModelsRequest[] = [];
  const listeners = new Set<(message: unknown) => void>();
  const emit = (message: ModelsHostMessage) => {
    for (const listener of listeners) listener(message);
  };
  const publish = (models = snapshot.models) => {
    snapshot = { ...snapshot, models };
    emit({ type: 'models.snapshot', version: MODEL_MANAGER_VERSION, snapshot });
  };
  const finish = (outcome: Pick<Extract<ModelsHostMessage, { type: 'models.result' }>, 'ok'> &
    Partial<Pick<Extract<ModelsHostMessage, { type: 'models.result' }>, 'message' | 'discovered'>>) => {
    publish();
    emit({
      type: 'models.result', version: MODEL_MANAGER_VERSION,
      requestId: requests.at(-1)!.requestId, message: 'Synthetic operation result', ...outcome,
    });
  };
  const transport: ModelsTransport = {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    postMessage(request) {
      requests.push(request);
      if (request.action.kind === 'refresh') finish({ ok: true });
    },
  };
  return { transport, requests, publish, finish };
}

function setup() {
  const host = createHost();
  const { result } = renderHook(() => useModelsPage(host.transport));
  act(() => result.current.setDiscovery({ connectionId: 'first', items: catalog }));
  act(() => result.current.setChosen(new Set(['alpha', 'beta'])));
  return { host, result };
}

describe('model discovery selection', () => {
  it('retains only unsaved choices after a partial import and retries only those models', async () => {
    const { host, result } = setup();
    let imported!: Promise<boolean>;
    act(() => { imported = result.current.importModels('first', catalog); });
    expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [{ model: 'alpha' }, { model: 'beta' }],
    });
    await act(async () => {
      host.publish([savedModel('alpha')]);
      host.finish({ ok: false, message: '1 model saved before import stopped.' });
      expect(await imported).toBe(false);
    });
    expect([...result.current.chosen]).toEqual(['beta']);
    expect(result.current.discovered).toEqual(catalog);
    expect(result.current.manager.notice?.ok).toBe(false);

    act(() => { imported = result.current.importModels('first', catalog); });
    expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [{ model: 'beta' }],
    });
    await act(async () => { host.finish({ ok: true }); expect(await imported).toBe(true); });
    expect(result.current.chosen.size).toBe(0);
    expect(result.current.discovered).toBeNull();
  });

  it('checks the latest snapshot before importing even before the next React render', async () => {
    const { host, result } = setup();
    let imported!: Promise<boolean>;
    act(() => {
      host.publish([savedModel('alpha')]);
      imported = result.current.importModels('first', catalog);
    });
    expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [{ model: 'beta' }],
    });
    await act(async () => { host.finish({ ok: true }); await imported; });
  });

  it('keeps the previous catalog and choices when refreshing the catalog fails', async () => {
    const { host, result } = setup();
    let discovery!: Promise<void>;
    act(() => { discovery = result.current.discoverModels('first'); });
    expect(result.current.discovered).toEqual(catalog);
    expect([...result.current.chosen]).toEqual(['alpha', 'beta']);
    await act(async () => { host.finish({ ok: false }); await discovery; });
    expect(result.current.discovered).toEqual(catalog);
    expect([...result.current.chosen]).toEqual(['alpha', 'beta']);
  });

  it('keeps only selected unsaved models still offered by the refreshed catalog', async () => {
    const { host, result } = setup();
    act(() => result.current.setChosen(new Set(['alpha', 'beta', 'gamma'])));
    let discovery!: Promise<void>;
    act(() => { discovery = result.current.discoverModels('first'); });
    const refreshed = [{ model: 'alpha' }, { model: 'beta' }, { model: 'delta' }];
    await act(async () => {
      host.publish([savedModel('alpha')]);
      host.finish({ ok: true, discovered: refreshed });
      await discovery;
    });
    expect(result.current.discovered).toEqual(refreshed);
    expect([...result.current.chosen]).toEqual(['beta']);
  });

  it('preserves the catalog, choices and search when choosing the current interface again', () => {
    const { result } = setup();
    act(() => result.current.setSearch('existing draft'));
    act(() => result.current.setSelectedId('first'));
    expect(result.current.discovered).toEqual(catalog);
    expect([...result.current.chosen]).toEqual(['alpha', 'beta']);
    expect(result.current.search).toBe('existing draft');
    act(() => result.current.selectProvider(result.current.group!));
    expect(result.current.discovered).toEqual(catalog);
    expect([...result.current.chosen]).toEqual(['alpha', 'beta']);
  });

  it('clears selections and discovery when changing interfaces even if their Model IDs overlap', async () => {
    const { host, result } = setup();
    act(() => result.current.setSearch('first interface query'));
    act(() => result.current.setSelectedId('second'));
    expect(result.current.connection?.id).toBe('second');
    expect(result.current.discovered).toBeNull();
    expect(result.current.chosen.size).toBe(0);
    expect(result.current.search).toBe('');
    let discovery!: Promise<void>;
    act(() => { discovery = result.current.discoverModels('second'); });
    await act(async () => { host.finish({ ok: true, discovered: catalog }); await discovery; });
    expect(result.current.discovered).toEqual(catalog);
    expect(result.current.chosen.size).toBe(0);
    act(() => result.current.setSelectedId('first'));
    expect(result.current.discovered).toBeNull();
    expect(result.current.chosen.size).toBe(0);
  });
});
