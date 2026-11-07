// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@droidvisx/chat-ui/i18n';
import { createModelsPreviewSnapshot } from '../dev/modelsPreviewTransport';
import { ModelList } from './ModelList';

afterEach(cleanup);

it('routes direct actions with model identity and keeps disabled recovery in the overflow menu', async () => {
  const snapshot = createModelsPreviewSnapshot();
  const model = snapshot.models[0]!;
  const onAction = vi.fn(), onEdit = vi.fn();
  const props = { snapshot, disabled: false, onAction, onEdit };
  const user = userEvent.setup();
  const view = render(<ModelList {...props} models={[model]} />, {
    wrapper: ({ children }) => <I18nProvider locale="zh-CN">{children}</I18nProvider>,
  });
  await user.click(screen.getByRole('button', { name: '使用此模型' }));
  await user.click(screen.getByRole('button', { name: '验证模型…' }));
  await user.click(screen.getByRole('button', { name: '编辑配置' }));
  expect(onAction.mock.calls.map(([action]) => action)).toEqual([
    { kind: 'useModel', rawIndex: model.rawIndex, expectedModel: model.model, connectionId: model.connectionId },
    { kind: 'verifyModel', rawIndex: model.rawIndex, expectedModel: model.model, connectionId: model.connectionId },
  ]);
  expect(onEdit).toHaveBeenCalledWith(model);
  onAction.mockClear();
  view.rerender(<ModelList {...props} models={[{ ...model, enabled: false }]} />);
  expect((screen.getByRole('button', { name: '使用此模型' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '验证模型…' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: /的更多操作/ }));
  await user.click(screen.getByRole('menuitem', { name: '恢复模型' }));
  expect(onAction).toHaveBeenCalledWith({
    kind: 'setModelEnabled', rawIndex: model.rawIndex, expectedModel: model.model,
    provider: snapshot.connections[0]!.protocol, baseUrl: snapshot.connections[0]!.baseUrl, enabled: true,
  });
});
