// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiscoveredCustomModel } from '../../shared/protocol/customModelsProtocol';
import {
  MODEL_MANAGER_VERSION,
  type ManagedModel,
  type ModelsHostMessage,
  type ModelsRequest,
  type ModelsSnapshot,
} from '../../shared/protocol/modelManagerProtocol';
import { ModelsApp } from './ModelsApp';
import type { ModelsTransport } from './useModels';

afterEach(cleanup);

function savedModel(model: string, displayName: string, connectionId = 'first'): ManagedModel {
  return {
    rawIndex: 0, model, displayName, connectionId, maxOutputTokens: null,
    noImageSupport: false, valid: true, runtimeId: `loaded:${model}`,
    loadMessage: 'Loaded by Droid', test: null,
  };
}

function createHost(discovered: readonly DiscoveredCustomModel[], models: readonly ManagedModel[] = []) {
  let snapshot: ModelsSnapshot = {
    connections: ['first', 'second'].map((id) => ({
      id, name: id === 'first' ? 'First endpoint' : 'Second endpoint', protocol: 'generic-chat-completion-api' as const,
      baseUrl: `https://gateway.example.com/${id}`, hasKey: true, imported: false,
    })),
    models, activeModelId: null, canApply: true, applyMessage: 'Idle',
  };
  const requests: ModelsRequest[] = [];
  const listeners = new Set<(message: unknown) => void>();
  const emit = (message: ModelsHostMessage) => { for (const listener of listeners) listener(message); };
  const transport: ModelsTransport = {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    postMessage(request) {
      requests.push(request);
      const action = request.action;
      if (action.kind === 'importModels') {
        snapshot = { ...snapshot, models: [...snapshot.models, ...action.models.map((model, index) => ({
          ...savedModel(model.model, model.displayName || model.model, action.connectionId),
          rawIndex: snapshot.models.length + index,
        }))] };
      }
      emit({ type: 'models.snapshot', version: MODEL_MANAGER_VERSION, snapshot });
      emit({
        type: 'models.result', version: MODEL_MANAGER_VERSION, requestId: request.requestId,
        ok: true, message: 'Synthetic operation completed',
        ...(action.kind === 'discover' ? { discovered } : {}),
      });
    },
  };
  return { transport, requests };
}

async function openAddModels(host: ReturnType<typeof createHost>) {
  render(<ModelsApp transport={host.transport} />);
  await screen.findByRole('heading', { name: 'First endpoint' });
  fireEvent.click(screen.getByRole('button', { name: '向First endpoint添加模型' }));
  return screen.findByRole('dialog', { name: 'First endpoint · 添加模型' });
}

async function discover(host: ReturnType<typeof createHost>, firstId: string) {
  const dialog = await openAddModels(host);
  await within(dialog).findByRole('checkbox', { name: firstId, exact: true });
  return dialog;
}

describe('model discovery interactions', () => {
  it('selects matching unsaved models in bulk and preserves the selection when filters hide it', async () => {
    const host = createHost([
      { model: 'code-old', displayName: 'Code existing' },
      { model: 'code-a', displayName: 'Fast coder' },
      { model: 'model-b', displayName: 'Code reasoning' },
      { model: 'vision', displayName: 'Fast vision' },
    ], [savedModel('code-old', 'Code existing')]);
    const dialog = await discover(host, 'code-old');
    const view = within(dialog);
    fireEvent.change(view.getByRole('searchbox', { name: '筛选发现的模型' }), { target: { value: 'code' } });
    fireEvent.click(view.getByRole('button', { name: '选择筛选结果' }));
    expect(view.getByRole('checkbox', { name: 'code-old' }).hasAttribute('disabled')).toBe(true);
    expect(view.getByRole('checkbox', { name: 'code-a' }).getAttribute('aria-checked')).toBe('true');
    expect(view.getByRole('checkbox', { name: 'model-b' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(view.getByRole('checkbox', { name: '隐藏已添加' }));
    expect(view.queryByRole('checkbox', { name: 'code-old' })).toBeNull();
    fireEvent.change(view.getByRole('searchbox', { name: '筛选发现的模型' }), { target: { value: 'vision' } });
    expect(view.getByText('已选 2 个')).toBeTruthy();
    expect(view.getByText('2 个在当前筛选之外')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '添加所选模型（2）' }));
    await waitFor(() => expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [
        { model: 'code-a', displayName: 'Fast coder' },
        { model: 'model-b', displayName: 'Code reasoning' },
      ],
    }));
  });

  it('allows an alias shared with another channel and preserves an explicit rename', async () => {
    const host = createHost([{ model: 'new-model', displayName: 'Shared name' }], [savedModel('existing', 'Shared name', 'second')]);
    const dialog = await discover(host, 'new-model');
    const view = within(dialog);
    fireEvent.click(view.getByRole('checkbox', { name: 'new-model' }));
    const submit = view.getByRole('button', { name: '添加所选模型（1）' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(view.getByRole('button', { name: '修改 new-model 的导入别名' }));
    fireEvent.change(view.getByRole('textbox', { name: /显示别名/ }), { target: { value: 'First endpoint model' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [{ model: 'new-model', displayName: 'First endpoint model' }],
    }));
  });

  it('allows shared aliases within a batch and preserves explicit renames', async () => {
    const host = createHost([{ model: 'alpha', displayName: 'Shared' }, { model: 'beta', displayName: 'Shared' }]);
    const dialog = await discover(host, 'alpha');
    const view = within(dialog);
    fireEvent.click(view.getByRole('button', { name: '选择筛选结果' }));
    const submit = view.getByRole('button', { name: '添加所选模型（2）' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(view.getByRole('button', { name: '修改 beta 的导入别名' }));
    fireEvent.change(view.getByRole('textbox', { name: /显示别名/ }), { target: { value: 'Beta personal' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(host.requests.at(-1)?.action).toEqual({
      kind: 'importModels', connectionId: 'first', models: [
        { model: 'alpha', displayName: 'Shared' }, { model: 'beta', displayName: 'Beta personal' },
      ],
    }));
  });

  it('preserves a manual draft across tabs and starts fresh for another channel', async () => {
    const host = createHost([]);
    const dialog = await openAddModels(host);
    const view = within(dialog);
    const user = userEvent.setup();
    await user.click(view.getByRole('tab', { name: '手动填写 ID' }));
    fireEvent.change(view.getByRole('textbox', { name: '模型 ID', exact: true }), { target: { value: 'draft-model' } });
    await user.click(view.getByRole('tab', { name: '从列表选择' }));
    await user.click(view.getByRole('tab', { name: '手动填写 ID' }));
    expect((view.getByRole('textbox', { name: '模型 ID', exact: true }) as HTMLInputElement).value).toBe('draft-model');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '向Second endpoint添加模型' }));
    const second = within(await screen.findByRole('dialog', { name: 'Second endpoint · 添加模型' }));
    await user.click(second.getByRole('tab', { name: '手动填写 ID' }));
    expect((second.getByRole('textbox', { name: '模型 ID', exact: true }) as HTMLInputElement).value).toBe('');
    expect(host.requests.some(request => request.action.kind === 'saveModel')).toBe(false);
  });});

import { I18nProvider } from '@droidvisx/chat-ui/i18n';
import type { ReactNode } from 'react';
const render = (node: ReactNode) => renderBase(node, { wrapper: ({children}) => <I18nProvider locale="zh-CN">{children}</I18nProvider> });
