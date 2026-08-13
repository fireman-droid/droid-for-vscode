import { describe, expect, it } from 'vitest';

import {
  parseSubagentActivityMessage,
  parseSubagentOpenTranscriptMessage,
  parseSubagentPanelMessage,
  parseSubagentStopMessage,
  parseSubagentWebviewMessage,
} from './subagentProtocol';

describe('subagentProtocol W→H parsers', () => {
  it('accepts the three well-formed webview messages', () => {
    expect(
      parseSubagentOpenTranscriptMessage({
        type: 'subagent.openTranscript',
        sessionId: 'session-1',
        toolUseId: 'use-1',
      }),
    ).toEqual({
      type: 'subagent.openTranscript',
      sessionId: 'session-1',
      toolUseId: 'use-1',
    });
    expect(
      parseSubagentStopMessage({
        type: 'subagent.stop',
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
      }),
    ).toEqual({
      type: 'subagent.stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'use-1',
    });
    expect(
      parseSubagentPanelMessage({
        type: 'subagent.panel',
        sessionId: 'session-1',
        open: true,
      }),
    ).toEqual({
      type: 'subagent.panel',
      sessionId: 'session-1',
      open: true,
    });
  });

  it('dispatches the family through one entry point', () => {
    expect(
      parseSubagentWebviewMessage({
        type: 'subagent.panel',
        sessionId: 'session-1',
        open: false,
      }),
    ).toMatchObject({ type: 'subagent.panel', open: false });
    expect(parseSubagentWebviewMessage({ type: 'turn.send' })).toBeNull();
  });

  it.each([
    // Extra keys are rejected — including a smuggled child id.
    {
      type: 'subagent.openTranscript',
      sessionId: 's',
      toolUseId: 'u',
      childSessionId: 'leak',
    },
    { type: 'subagent.openTranscript', sessionId: 's' },
    { type: 'subagent.openTranscript', sessionId: '', toolUseId: 'u' },
    { type: 'subagent.stop', sessionId: 's', toolUseId: 'u' },
    { type: 'subagent.stop', sessionId: 's', turnId: 4, toolUseId: 'u' },
    { type: 'subagent.panel', sessionId: 's', open: 'yes' },
    { type: 'subagent.panel', open: true },
  ])('rejects malformed webview payloads %#', (payload) => {
    expect(parseSubagentWebviewMessage(payload)).toBeNull();
  });
});

describe('parseSubagentActivityMessage', () => {
  const base = {
    type: 'subagent.activity',
    sequence: 7,
    sessionId: 'session-1',
    turnId: 'turn-1',
    toolUseId: 'use-1',
    action: 'Grep',
    stoppable: true,
  };

  it('accepts an action-bearing update and a null action', () => {
    expect(parseSubagentActivityMessage(base)).toEqual(base);
    expect(
      parseSubagentActivityMessage({
        ...base,
        action: null,
        stoppable: false,
      }),
    ).toEqual({ ...base, action: null, stoppable: false });
  });

  it.each([
    { ...base, action: '' },
    { ...base, action: 'x'.repeat(65) },
    { ...base, stoppable: 'yes' },
    { ...base, sequence: Number.NaN },
    { ...base, childSessionId: 'leak' },
    (() => {
      const { toolUseId: _dropped, ...rest } = base;
      return rest;
    })(),
  ])('rejects malformed activity payloads %#', (payload) => {
    expect(parseSubagentActivityMessage(payload)).toBeNull();
  });
});
