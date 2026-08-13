// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AddModelEntry,
  CustomModelsContext,
  CustomModelsPanel,
  useCustomModelsFlow,
  type CustomModelsFlowValue,
} from './CustomModelsPanel';
import type { CustomModelListItem } from '../../shared/customModelsProtocol';

afterEach(cleanup);

const LUNA: CustomModelListItem = {
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
};

const QWEN: CustomModelListItem = {
  rawIndex: 1,
  model: 'qwen3:4b',
  provider: 'generic-chat-completion-api',
  baseUrl: 'http://localhost:11434/v1',
  hasApiKey: false,
  hasBedrockConfig: true,
  isValid: false,
};

function flowValue(
  overrides: Partial<CustomModelsFlowValue> = {},
): CustomModelsFlowValue {
  return {
    customModels: { status: 'ready', items: [LUNA, QWEN] },
    onRefresh: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function renderPanel(value: CustomModelsFlowValue) {
  const onBack = vi.fn();
  render(
    <CustomModelsContext.Provider value={value}>
      <CustomModelsPanel id="cm" onBack={onBack} />
    </CustomModelsContext.Provider>,
  );
  return { onBack };
}

function stateMessage(
  sessionId: string,
  customModels: unknown,
  sequence = 1,
): unknown {
  return { type: 'customModels.state', sequence, sessionId, customModels };
}

describe('useCustomModelsFlow', () => {
  it('posts refresh/save/delete stamped with the session id', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useCustomModelsFlow({ postMessage }, 'session-1'),
    );
    result.current.onRefresh();
    result.current.onSave({
      model: 'qwen3:4b',
      provider: 'generic-chat-completion-api',
      baseUrl: 'http://localhost:11434/v1',
      maxOutputTokens: null,
      noImageSupport: false,
    });
    result.current.onDelete(1, 'qwen3:4b');
    expect(postMessage.mock.calls.map(([m]) => m)).toEqual([
      { type: 'customModels.refresh', sessionId: 'session-1' },
      {
        type: 'customModels.save',
        sessionId: 'session-1',
        model: 'qwen3:4b',
        provider: 'generic-chat-completion-api',
        baseUrl: 'http://localhost:11434/v1',
        maxOutputTokens: null,
        noImageSupport: false,
      },
      {
        type: 'customModels.delete',
        sessionId: 'session-1',
        rawIndex: 1,
        expectedModel: 'qwen3:4b',
      },
    ]);
  });

  it('posts nothing without a bound session', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useCustomModelsFlow({ postMessage }, null),
    );
    result.current.onRefresh();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('applies validated pushes for the current session only', async () => {
    const { result } = renderHook(() =>
      useCustomModelsFlow({ postMessage: vi.fn() }, 'session-1'),
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: stateMessage('session-other', {
            status: 'ready',
            items: [LUNA],
          }),
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: stateMessage('session-1', {
            status: 'ready',
            // Hostile: an item smuggling key material fails the
            // shared exact-keys validator, dropping the message.
            items: [{ ...LUNA, apiKey: 'sk-leak' }],
          }),
        }),
      );
    });
    expect(result.current.customModels.status).toBe('idle');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: stateMessage('session-1', {
            status: 'ready',
            items: [LUNA],
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.customModels).toEqual({
        status: 'ready',
        items: [LUNA],
      });
    });
  });

  it('merges empty loading over the previous list and resets on session switch', () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) =>
        useCustomModelsFlow({ postMessage: vi.fn() }, sessionId),
      { initialProps: { sessionId: 'session-1' as string | null } },
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: stateMessage('session-1', {
            status: 'ready',
            items: [LUNA],
          }),
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: stateMessage(
            'session-1',
            { status: 'loading', items: [] },
            2,
          ),
        }),
      );
    });
    expect(result.current.customModels).toEqual({
      status: 'loading',
      items: [LUNA],
    });
    rerender({ sessionId: 'session-2' });
    expect(result.current.customModels).toEqual({
      status: 'idle',
      items: [],
    });
  });
});

describe('AddModelEntry', () => {
  it('re-reads the list and opens the panel', async () => {
    const value = flowValue();
    const onOpen = vi.fn();
    render(
      <CustomModelsContext.Provider value={value}>
        <AddModelEntry onOpen={onOpen} />
      </CustomModelsContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /add model/i }),
    );
    expect(value.onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('CustomModelsPanel list', () => {
  it('renders masked rows with quiet badges', () => {
    renderPanel(flowValue());
    expect(screen.getByText('GPT-5.6 Luna')).toBeTruthy();
    expect(screen.getByText('••••c752')).toBeTruthy();
    expect(screen.getByText('no key')).toBeTruthy();
    expect(screen.getByText('Bedrock')).toBeTruthy();
    expect(screen.getByText('Invalid')).toBeTruthy();
    expect(
      screen.getByText(/qwen3:4b · generic-chat-completion-api/),
    ).toBeTruthy();
  });

  it('re-pulls when the state is idle (session-switch recovery)', () => {
    const value = flowValue({
      customModels: { status: 'idle', items: [] },
    });
    renderPanel(value);
    expect(value.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable copy and disables Add', () => {
    const value = flowValue({
      customModels: {
        status: 'unavailable',
        items: [],
        message: 'Custom models need the local droid daemon.',
      },
    });
    renderPanel(value);
    expect(
      screen.getByText(/need the local droid daemon/),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('deletes only after the inline confirm and warns about id drift', async () => {
    const value = flowValue();
    renderPanel(value);
    const [deleteLuna] = screen.getAllByRole('button', {
      name: 'Delete',
    });
    await userEvent.click(deleteLuna!);
    expect(value.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/custom: ids/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm?' }),
    );
    expect(value.onDelete).toHaveBeenCalledWith(0, 'gpt-5.6-luna');
  });
});

describe('CustomModelsPanel form', () => {
  it('gates Save until required fields are valid, then saves a create', async () => {
    const value = flowValue();
    renderPanel(value);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const save = screen.getByRole('button', {
      name: 'Add model',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await userEvent.type(
      screen.getByLabelText('Model ID *'),
      'qwen3:4b',
    );
    await userEvent.type(
      screen.getByLabelText('Base URL *'),
      'ftp://wrong',
    );
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/starting with http/)).toBeTruthy();

    await userEvent.clear(screen.getByLabelText('Base URL *'));
    await userEvent.type(
      screen.getByLabelText('Base URL *'),
      'http://localhost:11434/v1',
    );
    await userEvent.click(
      screen.getByRole('radio', { name: 'Generic' }),
    );
    await userEvent.type(screen.getByLabelText('API key'), 'sk-test-1');
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(value.onSave).toHaveBeenCalledWith({
      model: 'qwen3:4b',
      provider: 'generic-chat-completion-api',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test-1',
      maxOutputTokens: null,
      noImageSupport: false,
    });
  });

  it('prefills an edit, keeps the key by omission, and sends the guard pair', async () => {
    const value = flowValue();
    renderPanel(value);
    const [editLuna] = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(editLuna!);

    const keyField = screen.getByLabelText(
      'API key',
    ) as HTMLInputElement;
    expect(keyField.placeholder).toContain('••••c752');
    expect(keyField.value).toBe('');
    expect(
      (screen.getByLabelText('Model ID *') as HTMLInputElement).value,
    ).toBe('gpt-5.6-luna');

    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Luna Edited');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save changes' }),
    );
    expect(value.onSave).toHaveBeenCalledWith({
      rawIndex: 0,
      expectedModel: 'gpt-5.6-luna',
      model: 'gpt-5.6-luna',
      displayName: 'Luna Edited',
      provider: 'openai',
      baseUrl: 'http://38.47.121.18:8080',
      maxOutputTokens: 16384,
      noImageSupport: false,
    });
  });

  it('notes that advanced fields survive when editing a Bedrock entry', async () => {
    const value = flowValue();
    renderPanel(value);
    const [, editQwen] = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(editQwen!);
    expect(
      screen.getByText(/advanced fields stay as configured/i),
    ).toBeTruthy();
  });

  it('rejects a non-numeric token limit with the one hint', async () => {
    const value = flowValue();
    renderPanel(value);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.type(
      screen.getByLabelText('Model ID *'),
      'qwen3:4b',
    );
    await userEvent.type(
      screen.getByLabelText('Base URL *'),
      'http://localhost:11434/v1',
    );
    await userEvent.type(
      screen.getByLabelText('Max output tokens'),
      '12.5',
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Add model',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/positive whole number/),
    ).toBeTruthy();
  });
});
