import { describe, expect, it } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from './bridgeMessages';
import {
  isWebviewToHostMessage,
  parseWebviewMessage,
} from './validateMessage';

describe('parseWebviewMessage', () => {
  it.each([
    {
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    },
    {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'Explain this file.',
    },
    {
      type: 'turn.stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'Ask this instead.',
    },
    {
      type: 'runtime.retry',
      sessionId: null,
    },
    {
      type: 'runtime.retry',
      sessionId: 'session-1',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_edit',
      editedSpecContent: '',
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [{ index: 0, answer: 'Production' }],
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: true,
      answers: [],
    },
    {
      type: 'sessions.refresh',
    },
    {
      type: 'session.select',
      sessionId: 'session-1',
    },
    {
      type: 'session.new',
    },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'Renamed session',
    },
    {
      type: 'session.context.refresh',
      sessionId: 'session-1',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'mission',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'model-1',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'xhigh',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    },
  ])('accepts $type', (message) => {
    expect(parseWebviewMessage(message)).toEqual(message);
    expect(isWebviewToHostMessage(message)).toBe(true);
  });

  it.each([
    null,
    [],
    'turn.send',
    {},
    { type: 'unknown' },
    { type: 'webview.ready', protocolVersion: 1 },
    {
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      extra: true,
    },
    { type: 'turn.send', sessionId: '', turnId: 'turn-1', text: 'Hello' },
    {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: '',
    },
    { type: 'turn.stop', sessionId: 'session-1' },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: '',
      text: 'Ask this instead.',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: '',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'Ask this instead.',
      extra: true,
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'm'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      text: 'Ask this instead.',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1),
    },
    { type: 'runtime.retry' },
    { type: 'runtime.retry', sessionId: 42 },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: '',
      selectedOption: 'proceed_once',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: '',
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [],
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: true,
      answers: [{ index: 0, answer: 'No' }],
    },
    { type: 'sessions.refresh', extra: true },
    { type: 'session.select', sessionId: '' },
    {
      type: 'session.select',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
    },
    { type: 'session.new', sessionId: 'session-1' },
    { type: 'session.rename', sessionId: 'session-1', title: '' },
    { type: 'session.rename', sessionId: 'session-1', title: '   ' },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 't'.repeat(MAX_SESSION_TITLE_LENGTH + 1),
    },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'Renamed',
      extra: true,
    },
    { type: 'session.rename', sessionId: '', title: 'Renamed' },
    { type: 'session.context.refresh', sessionId: '' },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'agi',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 3,
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'unknown',
      value: 'high',
    },
  ])('rejects malformed input %#', (message) => {
    expect(parseWebviewMessage(message)).toBeUndefined();
    expect(isWebviewToHostMessage(message)).toBe(false);
  });

  it('rejects hostile objects without throwing', () => {
    const message = new Proxy(
      { type: 'turn.stop', sessionId: 'session-1', turnId: 'turn-1' },
      {
        ownKeys() {
          throw new Error('hostile object');
        },
      },
    );

    expect(() => parseWebviewMessage(message)).not.toThrow();
    expect(parseWebviewMessage(message)).toBeUndefined();
  });

  it('rejects symbol-keyed additions to an otherwise exact shape', () => {
    const message = {
      type: 'turn.stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
      [Symbol('hostile-extra')]: true,
    };

    expect(parseWebviewMessage(message)).toBeUndefined();
  });

  it('enforces identifier size boundaries', () => {
    const maximum = {
      type: 'turn.send',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
      turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
      text: 'Prompt',
    };

    expect(parseWebviewMessage(maximum)).toEqual(maximum);
    expect(
      parseWebviewMessage({
        ...maximum,
        sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('accepts a prompt at the exact shared length limit', () => {
    const message = {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'x'.repeat(MAX_TURN_TEXT_LENGTH),
    };

    expect(parseWebviewMessage(message)).toEqual(message);
  });

  it.each([
    ['interactionMode', 'auto'],
    ['interactionMode', 'spec'],
    ['interactionMode', 'mission'],
    ['autonomyLevel', 'off'],
    ['autonomyLevel', 'low'],
    ['autonomyLevel', 'medium'],
    ['autonomyLevel', 'high'],
    ['reasoningEffort', 'none'],
    ['reasoningEffort', 'dynamic'],
    ['reasoningEffort', 'off'],
    ['reasoningEffort', 'minimal'],
    ['reasoningEffort', 'low'],
    ['reasoningEffort', 'medium'],
    ['reasoningEffort', 'high'],
    ['reasoningEffort', 'xhigh'],
    ['reasoningEffort', 'max'],
  ])('accepts legal %s value %s', (field, value) => {
    expect(
      parseWebviewMessage({
        type: 'session.setting.update',
        sessionId: 'session-1',
        field,
        value,
      }),
    ).toBeDefined();
  });

  it('bounds model IDs and rejects hostile setting commands', () => {
    const maximum = {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'm'.repeat(MAX_MODEL_ID_LENGTH),
    };
    expect(parseWebviewMessage(maximum)).toEqual(maximum);
    expect(
      parseWebviewMessage({
        ...maximum,
        value: 'm'.repeat(MAX_MODEL_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        [Symbol('extra')]: true,
      }),
    ).toBeUndefined();

    const accessor = {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      get value() {
        throw new Error('hostile value');
      },
    };
    const proxy = new Proxy(maximum, {
      ownKeys() {
        throw new Error('hostile command');
      },
    });
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });

  it('rejects a prompt one character over the shared length limit', () => {
    expect(
      parseWebviewMessage({
        type: 'turn.send',
        sessionId: 'session-1',
        turnId: 'turn-1',
        text: 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('accepts exact interaction response boundaries', () => {
    expect(
      parseWebviewMessage({
        type: 'permission.respond',
        sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
        turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
        requestId: 'r'.repeat(MAX_BRIDGE_ID_LENGTH),
        selectedOption: 'o'.repeat(MAX_PERMISSION_OPTION_VALUE_LENGTH),
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH),
      }),
    ).toBeDefined();

    expect(
      parseWebviewMessage({
        type: 'ask-user.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'request-1',
        cancelled: false,
        answers: Array.from(
          { length: MAX_ASK_USER_ANSWERS },
          (_, index) => ({
            index:
              index === MAX_ASK_USER_ANSWERS - 1
                ? Number.MAX_SAFE_INTEGER
                : index,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH),
          }),
        ),
      }),
    ).toBeDefined();
  });

  it('rejects over-limit interaction response values', () => {
    const permission = {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
    };
    const askUser = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [{ index: 0, answer: 'Production' }],
    };

    expect(
      parseWebviewMessage({
        ...permission,
        requestId: 'r'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...permission,
        selectedOption: 'o'.repeat(
          MAX_PERMISSION_OPTION_VALUE_LENGTH + 1,
        ),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...permission,
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: Array.from(
          { length: MAX_ASK_USER_ANSWERS + 1 },
          (_, index) => ({ index, answer: 'answer' }),
        ),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: [
          {
            index: 0,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH + 1),
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: [{ index: Number.MAX_SAFE_INTEGER + 1, answer: 'answer' }],
      }),
    ).toBeUndefined();
  });

  it('rejects duplicate answer indices and nested extras', () => {
    const base = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
    };

    expect(
      parseWebviewMessage({
        ...base,
        answers: [
          { index: 0, answer: 'One' },
          { index: 0, answer: 'Two' },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...base,
        answers: [{ index: 0, answer: 'One', extra: true }],
      }),
    ).toBeUndefined();

    const answers = [{ index: 0, answer: 'One' }];
    Object.defineProperty(answers, 'extra', { value: true });
    expect(parseWebviewMessage({ ...base, answers })).toBeUndefined();

    const sparseAnswers = new Array(1);
    expect(
      parseWebviewMessage({ ...base, answers: sparseAnswers }),
    ).toBeUndefined();
  });

  it('rejects interaction symbols, accessors, and proxies without throwing', () => {
    const symbol = {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
      [Symbol('extra')]: true,
    };
    const accessor = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [
        {
          index: 0,
          get answer() {
            throw new Error('hostile answer');
          },
        },
      ],
    };
    const proxy = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: new Proxy([{ index: 0, answer: 'One' }], {
        ownKeys() {
          throw new Error('hostile answers');
        },
      }),
    };

    expect(parseWebviewMessage(symbol)).toBeUndefined();
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });

  it('rejects hostile session commands without throwing', () => {
    const symbol = {
      type: 'sessions.refresh',
      [Symbol('extra')]: true,
    };
    const accessor = {
      type: 'session.select',
      get sessionId() {
        throw new Error('hostile session id');
      },
    };
    const proxy = new Proxy(
      { type: 'session.new' },
      {
        ownKeys() {
          throw new Error('hostile command');
        },
      },
    );

    expect(parseWebviewMessage(symbol)).toBeUndefined();
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });
});
