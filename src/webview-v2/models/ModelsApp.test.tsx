// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsApp as ModelsAppV2 } from './ModelsApp';
import { createModelsPreviewTransport } from '../dev/modelsPreviewTransport';

afterEach(cleanup);
describe.each([['V2', ModelsAppV2]] as const)('%s Models editor save lifecycle', (_version, App) => {
  it('retains connection input on a failed save and closes only after confirmation', async () => {
    const preview = createModelsPreviewTransport();
    render(<App transport={preview.transport} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    fireEvent.click(screen.getByRole('button', { name: '创建渠道' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^接口别名/ }), {
      target: { value: 'My new gateway' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Base URL/ }), {
      target: { value: 'https://new.example.com/v1' },
    });
    preview.failSave();
    fireEvent.click(screen.getByRole('button', { name: '保存并输入密钥' }));
    await screen.findByRole('alert');
    expect(
      (screen.getByRole('textbox', { name: /^接口别名/ }) as HTMLInputElement)
        .value,
    ).toBe('My new gateway');
    fireEvent.click(screen.getByRole('button', { name: '保存并输入密钥' }));
    await screen.findByRole('heading', { name: 'My new gateway' });
    expect(screen.queryByRole('textbox', { name: /^接口别名/ })).toBeNull();
  });
  it('saves an edited Model ID before verifying it and disables chat selection while busy', async () => {
    const preview = createModelsPreviewTransport();
    const requests: Parameters<typeof preview.transport.postMessage>[0][] = [];
    const user = userEvent.setup();
    render(<App transport={{ ...preview.transport, postMessage: request => { requests.push(request); preview.transport.postMessage(request); } }} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    const row = screen.getByRole('heading', { name: 'Reasoner · Personal gateway' }).closest('article')!;
    await user.click(within(row).getByRole('button', { name: '编辑配置' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^模型 ID/ }), {
      target: { value: 'new-upstream-id' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /模型别名/ }), { target: { value: 'Renamed reasoner' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并验证…' }));
    await screen.findByText('Preview only: model verification was not executed.');
    expect(requests.slice(-2).map(request => request.action)).toEqual([
      expect.objectContaining({ kind: 'saveModel', draft: expect.objectContaining({ model: 'new-upstream-id', displayName: 'Renamed reasoner', maxOutputTokens: 8192 }) }),
      expect.objectContaining({ kind: 'verifyModel', expectedModel: 'new-upstream-id', connectionId: 'gateway' }),
    ]);
    expect(screen.queryByText('本窗口验证通过')).toBeNull();
    act(() => preview.busy(true));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('button', { name: '使用此模型' })
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true);
    });
  });
  it('keeps the combined model draft after a rejected save and discards it only on cancel', async () => {
    const preview = createModelsPreviewTransport();
    render(<App transport={preview.transport} />);
    const heading = await screen.findByRole('heading', { name: 'Reasoner · Personal gateway' });
    const edit = () => fireEvent.click(within(heading.closest('article')!).getByRole('button', { name: '编辑配置' }));
    edit();
    fireEvent.change(screen.getByRole('textbox', { name: /^模型 ID/ }), { target: { value: 'edited-id' } });
    fireEvent.change(screen.getByRole('textbox', { name: /模型别名/ }), { target: { value: 'Edited alias' } });
    fireEvent.change(screen.getByRole('textbox', { name: /最大输出 Token/ }), { target: { value: '4096' } });
    preview.failSave();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox', { name: /^模型 ID/ }) as HTMLInputElement).value).toBe('edited-id');
    expect((screen.getByRole('textbox', { name: /模型别名/ }) as HTMLInputElement).value).toBe('Edited alias');
    expect((screen.getByRole('textbox', { name: /最大输出 Token/ }) as HTMLInputElement).value).toBe('4096');
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
    edit();
    expect((screen.getByRole('textbox', { name: /^模型 ID/ }) as HTMLInputElement).value).toBe('gateway-reasoner');
    expect((screen.getByRole('textbox', { name: /模型别名/ }) as HTMLInputElement).value).toBe('Reasoner · Personal gateway');
    expect((screen.getByRole('textbox', { name: /最大输出 Token/ }) as HTMLInputElement).value).toBe('8192');
  });
  it('imports only newly selected discovered models and applies the refreshed model identity', async () => {
    const preview = createModelsPreviewTransport();
    const requests: Parameters<typeof preview.transport.postMessage>[0][] = [];
    const transport = {
      ...preview.transport,
      postMessage: (request: (typeof requests)[number]) => {
        requests.push(request);
        preview.transport.postMessage(request);
      },
    };
    render(<App transport={transport} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    fireEvent.click(screen.getByRole('button', { name: '向Personal gateway添加模型' }));
    const discovered = await screen.findByRole('dialog', { name: 'Personal gateway · 添加模型' });
    await within(discovered).findByRole('checkbox', { name: 'gateway-coder-32b' });
    expect(within(discovered).getByRole('checkbox', { name: /gateway-reasoner/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(discovered).getByRole('checkbox', { name: 'gateway-coder-32b' }));
    fireEvent.click(screen.getByRole('button', { name: '添加所选模型（1）' }));
    const modelHeading = await screen.findByRole('heading', { name: /gateway-coder-32b/ });
    const imported = requests.find((request) => request.action.kind === 'importModels');
    expect(imported?.action).toEqual({ kind: 'importModels', connectionId: 'gateway', models: [{ model: 'gateway-coder-32b' }] });
    const row = modelHeading.closest('article')!;
    fireEvent.click(within(row).getByRole('button', { name: '使用此模型' }));
    await waitFor(() => {
      expect(requests.at(-1)?.action).toMatchObject({ kind: 'useModel', expectedModel: 'gateway-coder-32b' });
    });
  });
});

import { I18nProvider } from '@droidvisx/chat-ui/i18n';
import type { ReactNode } from 'react';
const render = (node: ReactNode) => renderBase(node, { wrapper: ({children}) => <I18nProvider locale="zh-CN">{children}</I18nProvider> });
