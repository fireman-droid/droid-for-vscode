import { describe, expect, it } from 'vitest';

import {
  IDLE_CUSTOM_MODELS_STATE,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  mergeCustomModelsState,
  parseCustomModelDeleteMessage,
  parseCustomModelSaveMessage,
  parseCustomModelsRefreshMessage,
  parseCustomModelsState,
  parseCustomModelsStateMessage,
  type CustomModelListItem,
} from './customModelsProtocol';
import {
  MAX_MODEL_CATALOG_ITEMS,
  MAX_MODEL_ID_LENGTH,
} from './bridgeMessages';

const validSave = {
  type: 'customModels.save',
  sessionId: 'session-1',
  model: 'qwen3:4b',
  provider: 'generic-chat-completion-api',
  baseUrl: 'http://localhost:11434/v1',
  maxOutputTokens: null,
  noImageSupport: false,
} as const;

const validItem: CustomModelListItem = {
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

describe('parseCustomModelsRefreshMessage', () => {
  it('accepts the exact shape', () => {
    expect(
      parseCustomModelsRefreshMessage({
        type: 'customModels.refresh',
        sessionId: 's',
      }),
    ).toEqual({ type: 'customModels.refresh', sessionId: 's' });
  });

  it('rejects extra keys and bad ids', () => {
    expect(
      parseCustomModelsRefreshMessage({
        type: 'customModels.refresh',
        sessionId: 's',
        extra: 1,
      }),
    ).toBeNull();
    expect(
      parseCustomModelsRefreshMessage({
        type: 'customModels.refresh',
        sessionId: '',
      }),
    ).toBeNull();
  });
});

describe('parseCustomModelSaveMessage', () => {
  it('accepts a minimal create', () => {
    expect(parseCustomModelSaveMessage(validSave)).toEqual(validSave);
  });

  it('accepts a full edit with key and display name', () => {
    const message = {
      ...validSave,
      rawIndex: 3,
      expectedModel: 'qwen3:4b',
      displayName: 'Qwen 3',
      apiKey: 'sk-test-123',
      maxOutputTokens: 16384,
      noImageSupport: true,
    };
    expect(parseCustomModelSaveMessage(message)).toEqual(message);
  });

  it('accepts ${VAR} environment references as the key', () => {
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        // eslint-disable-next-line no-template-curly-in-string
        apiKey: '${MY_PROVIDER_KEY}',
      }),
    ).not.toBeNull();
  });

  it('rejects rawIndex without expectedModel and vice versa', () => {
    expect(
      parseCustomModelSaveMessage({ ...validSave, rawIndex: 0 }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        expectedModel: 'qwen3:4b',
      }),
    ).toBeNull();
  });

  it('rejects providers outside the whitelist', () => {
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        provider: 'bedrock-converse',
      }),
    ).toBeNull();
  });

  it('rejects non-http(s), whitespace, and oversized base URLs', () => {
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        baseUrl: 'file:///etc/passwd',
      }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        baseUrl: 'http://a b.com',
      }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        baseUrl: `http://h/${'a'.repeat(MAX_CUSTOM_MODEL_URL_LENGTH)}`,
      }),
    ).toBeNull();
  });

  it('rejects hostile keys: empty, control chars, oversized', () => {
    expect(
      parseCustomModelSaveMessage({ ...validSave, apiKey: '' }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({ ...validSave, apiKey: 'a\u0000b' }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        apiKey: 'k'.repeat(MAX_CUSTOM_MODEL_KEY_LENGTH + 1),
      }),
    ).toBeNull();
  });

  it('rejects hostile model ids and token bounds', () => {
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        model: 'm'.repeat(MAX_MODEL_ID_LENGTH + 1),
      }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({ ...validSave, model: ' padded ' }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        maxOutputTokens: 0,
      }),
    ).toBeNull();
    expect(
      parseCustomModelSaveMessage({
        ...validSave,
        maxOutputTokens: 1.5,
      }),
    ).toBeNull();
  });

  it('rejects missing required keys and unknown keys', () => {
    const { baseUrl: _dropped, ...withoutUrl } = validSave;
    expect(parseCustomModelSaveMessage(withoutUrl)).toBeNull();
    expect(
      parseCustomModelSaveMessage({ ...validSave, id: 'custom:X-0' }),
    ).toBeNull();
  });
});

describe('parseCustomModelDeleteMessage', () => {
  it('accepts the exact shape', () => {
    const message = {
      type: 'customModels.delete',
      sessionId: 's',
      rawIndex: 2,
      expectedModel: 'gpt-5.6-luna',
    };
    expect(parseCustomModelDeleteMessage(message)).toEqual(message);
  });

  it('rejects out-of-range indices and missing guards', () => {
    expect(
      parseCustomModelDeleteMessage({
        type: 'customModels.delete',
        sessionId: 's',
        rawIndex: -1,
        expectedModel: 'm',
      }),
    ).toBeNull();
    expect(
      parseCustomModelDeleteMessage({
        type: 'customModels.delete',
        sessionId: 's',
        rawIndex: MAX_MODEL_CATALOG_ITEMS,
        expectedModel: 'm',
      }),
    ).toBeNull();
    expect(
      parseCustomModelDeleteMessage({
        type: 'customModels.delete',
        sessionId: 's',
        rawIndex: 0,
      }),
    ).toBeNull();
  });
});

describe('parseCustomModelsState', () => {
  it('accepts ready items as the daemon shapes them', () => {
    expect(
      parseCustomModelsState({ status: 'ready', items: [validItem] }),
    ).toEqual({ status: 'ready', items: [validItem] });
  });

  it('accepts minimal items without optional fields', () => {
    const minimal = {
      rawIndex: 1,
      model: 'm',
      provider: 'openai',
      hasApiKey: false,
      hasBedrockConfig: true,
      isValid: false,
    };
    expect(
      parseCustomModelsState({ status: 'ready', items: [minimal] }),
    ).toEqual({ status: 'ready', items: [minimal] });
  });

  it('never accepts key material fields on items', () => {
    expect(
      parseCustomModelsState({
        status: 'ready',
        items: [{ ...validItem, apiKey: 'sk-leak' }],
      }),
    ).toBeNull();
  });

  it('rejects duplicate rawIndex entries', () => {
    expect(
      parseCustomModelsState({
        status: 'ready',
        items: [validItem, { ...validItem, model: 'other' }],
      }),
    ).toBeNull();
  });

  it('rejects unavailable states carrying items', () => {
    expect(
      parseCustomModelsState({
        status: 'unavailable',
        items: [validItem],
        message: 'x',
      }),
    ).toBeNull();
    expect(
      parseCustomModelsState({
        status: 'unavailable',
        items: [],
        message: 'daemon down',
      }),
    ).toEqual({
      status: 'unavailable',
      items: [],
      message: 'daemon down',
    });
  });

  it('rejects error states without a message and unknown statuses', () => {
    expect(
      parseCustomModelsState({ status: 'error', items: [] }),
    ).toBeNull();
    expect(
      parseCustomModelsState({ status: 'exploded', items: [] }),
    ).toBeNull();
  });

  it('rejects oversized lists', () => {
    const items = Array.from(
      { length: MAX_MODEL_CATALOG_ITEMS + 1 },
      (_, index) => ({ ...validItem, rawIndex: index }),
    );
    expect(
      parseCustomModelsState({ status: 'ready', items }),
    ).toBeNull();
  });
});

describe('parseCustomModelsStateMessage', () => {
  it('round-trips a full message', () => {
    const message = {
      type: 'customModels.state',
      sequence: 12,
      sessionId: 's',
      customModels: { status: 'loading', items: [] },
    };
    expect(parseCustomModelsStateMessage(message)).toEqual(message);
  });

  it('rejects bad sequences and extra keys', () => {
    expect(
      parseCustomModelsStateMessage({
        type: 'customModels.state',
        sequence: Number.NaN,
        sessionId: 's',
        customModels: { status: 'loading', items: [] },
      }),
    ).toBeNull();
    expect(
      parseCustomModelsStateMessage({
        type: 'customModels.state',
        sequence: 1,
        sessionId: 's',
        customModels: { status: 'loading', items: [] },
        apiKey: 'sk-leak',
      }),
    ).toBeNull();
  });
});

describe('mergeCustomModelsState', () => {
  it('keeps the previous list under an empty loading/error event', () => {
    const previous = { status: 'ready', items: [validItem] } as const;
    expect(
      mergeCustomModelsState(previous, { status: 'loading', items: [] }),
    ).toEqual({ status: 'loading', items: [validItem] });
    expect(
      mergeCustomModelsState(previous, {
        status: 'error',
        items: [],
        message: 'boom',
      }),
    ).toEqual({ status: 'error', items: [validItem], message: 'boom' });
  });

  it('replaces outright for ready, unavailable, and idle-previous', () => {
    const ready = { status: 'ready', items: [] } as const;
    expect(
      mergeCustomModelsState(
        { status: 'ready', items: [validItem] },
        ready,
      ),
    ).toBe(ready);
    const unavailable = {
      status: 'unavailable',
      items: [],
      message: 'down',
    } as const;
    expect(
      mergeCustomModelsState(
        { status: 'ready', items: [validItem] },
        unavailable,
      ),
    ).toBe(unavailable);
    const loading = { status: 'loading', items: [] } as const;
    expect(
      mergeCustomModelsState(IDLE_CUSTOM_MODELS_STATE, loading),
    ).toBe(loading);
  });
});
