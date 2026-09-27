// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsApp as ModelsAppV2 } from './ModelsApp';
import { createModelsPreviewTransport } from '../dev/modelsPreviewTransport';

afterEach(cleanup);
describe.each([['V2', ModelsAppV2]] as const)('%s Models editor save lifecycle', (_version, App) => {
  it('retains connection input on a failed save and closes only after confirmation', async () => {
    const preview = createModelsPreviewTransport();
    render(<App transport={preview.transport} />);
    await screen.findByRole('heading', { name: 'gateway.example.com' });
    fireEvent.click(screen.getByRole('button', { name: '添加服务商接口' }));
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
    await screen.findByRole('heading', { name: 'new.example.com' });
    expect(screen.getByRole('combobox', { name: '兼容接口' }).textContent).toContain('My new gateway');
    expect(screen.queryByRole('textbox', { name: /^接口别名/ })).toBeNull();
  });
  it('saves an edited Model ID before verifying it and disables chat selection while busy', async () => {
    const preview = createModelsPreviewTransport();
    const user = userEvent.setup();
    render(<App transport={preview.transport} />);
    await screen.findByRole('heading', { name: 'gateway.example.com' });
    await user.click(screen.getByRole('button', { name: 'Reasoner · Personal gateway 的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑配置' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Model ID/ }), {
      target: { value: 'new-upstream-id' },
    });
    await user.click(screen.getByRole('button', { name: '高级设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并验证…' }));
    await screen.findByText(/Simulated reply from new-upstream-id/);
    act(() => preview.busy(true));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('button', { name: '使用此模型' })
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true);
    });
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
    await screen.findByRole('heading', { name: 'gateway.example.com' });
    fireEvent.click(screen.getByRole('button', { name: '添加模型', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));
    const discovered = await screen.findByRole('dialog', { name: '添加模型' });
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
