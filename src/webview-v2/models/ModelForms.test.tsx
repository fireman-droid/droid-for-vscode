// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedModel, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import { AliasForm, ConnectionForm, ModelForm } from './ModelForms';

afterEach(cleanup);

const connection: ModelConnection = {
  id: 'gateway', name: 'Personal gateway', protocol: 'generic-chat-completion-api',
  baseUrl: 'https://gateway.example.com/v1', hasKey: true, imported: false,
};
const existing: ManagedModel = {
  rawIndex: 2, model: 'upstream-model', displayName: 'My model', connectionId: connection.id,
  maxOutputTokens: null, noImageSupport: false, valid: true, runtimeId: 'runtime-2', loadMessage: '', test: null,
};

describe('ConnectionForm validation and recovery', () => {
  it.each([
    'ftp://gateway.example.com',
    'https://user:password@gateway.example.com/v1',
    'https://gateway.example.com/v1?key=example',
    'https://gateway.example.com/v1#models',
    'https://gateway.example.com/a b',
    'gateway.example.com/v1',
  ])('rejects unsupported Base URL %s without losing input', (baseUrl) => {
    const save = vi.fn();
    render(<ConnectionForm connection={null} busy={false} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '接口别名' }), { target: { value: 'My gateway' } });
    const url = screen.getByRole('textbox', { name: /Base URL/ });
    fireEvent.change(url, { target: { value: baseUrl } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(url);
    expect(screen.getByRole('alert').textContent).toContain('HTTP(S)');
    fireEvent.click(screen.getByRole('button', { name: '保存并输入密钥' }));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(url);
    expect((url as HTMLInputElement).value).toBe(baseUrl);
    fireEvent.change(url, { target: { value: 'https://gateway.example.com/custom/v1/' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存并输入密钥' }));
    expect(save).toHaveBeenCalledWith({ name: 'My gateway', protocol: 'generic-chat-completion-api', baseUrl: 'https://gateway.example.com/custom/v1/', setApiKey: true });
  });

  it('focuses an all-whitespace alias before the missing address and preserves a corrected draft', () => {
    const save = vi.fn();
    render(<ConnectionForm connection={null} busy={false} onSave={save} onCancel={vi.fn()} />);
    const alias = screen.getByRole('textbox', { name: '接口别名' });
    fireEvent.change(alias, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并输入密钥' }));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(alias);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    fireEvent.change(alias, { target: { value: '  Local gateway  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Base URL/ }), { target: { value: 'http://localhost:1234/v1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '保存后输入 API Key' }));
    fireEvent.click(screen.getByRole('button', { name: '保存接口' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Local gateway', baseUrl: 'http://localhost:1234/v1', setApiKey: false }));
  });

  it('blocks submits while busy and preserves the edited connection and key preference', () => {
    const save = vi.fn();
    const props = { connection, onSave: save, onCancel: vi.fn() };
    const view = render(<ConnectionForm {...props} busy />);
    fireEvent.submit(screen.getByRole('textbox', { name: '接口别名' }).closest('form')!);
    expect(save).not.toHaveBeenCalled();
    view.rerender(<ConnectionForm {...props} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: '保存接口' }));
    expect(save).toHaveBeenCalledWith({ id: connection.id, name: connection.name, protocol: connection.protocol, baseUrl: connection.baseUrl, setApiKey: false });
  });
});

describe('ModelForm identity, advanced settings, and focus', () => {
  it('rejects an empty ID and duplicates on the current connection', () => {
    const save = vi.fn();
    render(<ModelForm model={null} connection={connection} existingModels={[existing]} busy={false} onSave={save} onCancel={vi.fn()} />);
    const id = screen.getByRole('textbox', { name: 'Model ID' });
    fireEvent.change(id, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(id);
    fireEvent.change(id, { target: { value: existing.model } });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    expect(screen.getByRole('alert').textContent).toContain('已有这个 Model ID');
    expect(save).not.toHaveBeenCalled();
  });

  it('allows a duplicate ID on another connection only with a unique display name', () => {
    const save = vi.fn();
    render(<ModelForm model={null} connection={connection} existingModels={[{ ...existing, connectionId: 'other', displayName: existing.model }]} busy={false} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Model ID' }), { target: { value: existing.model } });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    const alias = screen.getByRole('textbox', { name: /模型别名/ });
    expect(document.activeElement).toBe(alias);
    expect(screen.getByRole('alert').textContent).toContain('显示名称已被其他模型使用');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(alias, { target: { value: 'Unique alias' } });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ model: existing.model, displayName: 'Unique alias' }), false);
  });

  it('compares the same truncated fallback name as the Host', () => {
    const save = vi.fn();
    const longId = 'x'.repeat(170);
    render(<ModelForm model={null} connection={connection} existingModels={[{ ...existing, displayName: longId.slice(0, 160) }]} busy={false} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Model ID' }), { target: { value: longId } });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    expect(screen.getByRole('alert').textContent).toContain('显示名称已被其他模型使用');
    expect(save).not.toHaveBeenCalled();
  });

  it('excludes the edited model from ID and alias uniqueness checks', () => {
    const save = vi.fn();
    render(<ModelForm model={existing} connection={connection} existingModels={[existing]} busy={false} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(save).toHaveBeenCalledWith({ connectionId: connection.id, rawIndex: existing.rawIndex, expectedModel: existing.model, model: existing.model, displayName: existing.displayName, maxOutputTokens: null, noImageSupport: false }, false);
  });

  it.each(['0', '1.5', '100000001', 'not a number'])('reveals a collapsed invalid Token value %s and focuses it', (tokens) => {
    const save = vi.fn();
    render(<ModelForm model={existing} connection={connection} busy={false} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    const tokenInput = screen.getByRole('textbox', { name: /最大输出 Token/ });
    fireEvent.change(tokenInput, { target: { value: tokens } });
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('之间的整数');
    expect(document.activeElement).toBe(tokenInput);
    fireEvent.change(tokenInput, { target: { value: '8192' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '此模型不支持图片输入' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并验证…' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 8192, noImageSupport: true }), true);
  });

  it('does not submit while busy and keeps the draft when the operation ends', () => {
    const save = vi.fn();
    const props = { model: existing, connection, onSave: save, onCancel: vi.fn() };
    const view = render(<ModelForm {...props} busy={false} />);
    const id = screen.getByRole('textbox', { name: 'Model ID' });
    fireEvent.change(id, { target: { value: 'edited-model' } });
    view.rerender(<ModelForm {...props} busy />);
    fireEvent.submit(id.closest('form')!);
    expect(save).not.toHaveBeenCalled();
    view.rerender(<ModelForm {...props} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ model: 'edited-model' }), false);
  });

  it('does not take focus while inactive, but focuses Model ID when activated', () => {
    const props = { model: null, connection, busy: false, onSave: vi.fn(), onCancel: vi.fn() };
    const view = render(<ModelForm {...props} autoFocus={false} />);
    const id = screen.getByRole('textbox', { name: 'Model ID' });
    expect(document.activeElement).not.toBe(id);
    view.rerender(<ModelForm {...props} autoFocus />);
    expect(document.activeElement).toBe(id);
    const alias = screen.getByRole('textbox', { name: /模型别名/ });
    alias.focus();
    fireEvent.change(alias, { target: { value: 'New alias' } });
    expect(document.activeElement).toBe(alias);
  });
});

describe('AliasForm', () => {
  it('rejects whitespace, then accepts the corrected alias after busy ends', () => {
    const save = vi.fn();
    const props = { name: 'Old alias', label: '服务商别名', maxLength: 80, onSave: save, onCancel: vi.fn() };
    const view = render(<AliasForm {...props} busy={false} />);
    const alias = screen.getByRole('textbox', { name: props.label });
    fireEvent.change(alias, { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存别名' }));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(alias);
    fireEvent.change(alias, { target: { value: ' New alias ' } });
    view.rerender(<AliasForm {...props} busy />);
    fireEvent.submit(alias.closest('form')!);
    expect(save).not.toHaveBeenCalled();
    view.rerender(<AliasForm {...props} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: '保存别名' }));
    expect(save).toHaveBeenCalledWith('New alias');
  });
});
