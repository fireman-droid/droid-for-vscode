import { describe, expect, it } from 'vitest';
import { MAX_ASSISTANT_TEXT_LENGTH } from '../../shared/protocol/bounds';
import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import {
  type ToolActivityMessage,
  type ToolTranscriptItem,
} from '../../shared/bridgeMessages';
import {
  MAX_CONVERSATION_TOOL_RESULT_UNITS,
  enforceToolResultBudget,
  isToolResultPreview,
  preserveToolResultPreviews,
} from '../../shared/transcript/toolResultPreview';
import {
  trimTranscriptToLimits,
  transcriptTextUnits,
} from '../../shared/transcript/transcriptLimits';
import {
  createTurnActivityState,
  projectToolEvent,
} from '../chat/turns/turnActivityState';
import {
  createHostTranscriptState,
  projectHostTranscriptMessage,
} from './hostTranscriptState';
import { parseRecoveryTranscript } from './conversationRecoveryParser';
import { ingestConversationHistory } from './ingestConversationHistory';
import { parseSessionTranscript } from '../../webview/bridge/host/transcript';
import { readHostMessage } from '../../webview/bridge/validateHostMessage';
import { upsertTool } from '../../webview/assistant/transcript/toolTranscript';
import { assistantWebviewReducer } from '../../webview/assistant/state/store';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';

const preview = {
  availability: 'available' as const,
  source: { tool: 'Read' as const, path: 'app.ts', callId: 'call-1' },
  text: 'const value = 1;',
  truncated: false,
};
function tool(index = 1): ToolTranscriptItem {
  return {
    id: `tool-${index}`,
    kind: 'tool',
    turnId: 'turn-1',
    toolUseId: `call-${index}`,
    toolName: 'Read',
    action: 'Read workspace files',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    resultPreview: { ...preview, source: { ...preview.source, callId: `call-${index}` } },
  };
}
const user: SessionTranscriptItem = { id: 'user-1', kind: 'user', text: 'Read files' };
const history = (items: readonly SessionTranscriptItem[]) => ({
  transcript: [user, ...items],
  historyStatus: 'complete' as const,
  truncated: false,
});

describe('tool result projection, budget and recovery', () => {
  it('survives runtime projection, Host, Bridge, webview and recovery while outputTail stays live-only', () => {
    const started = projectToolEvent(createTurnActivityState(), {
      type: 'tool-start',
      toolUseId: 'call-1',
      toolName: 'Read',
      action: 'Read workspace files',
      target: 'app.ts',
    });
    const completed = projectToolEvent(started.state, {
      type: 'tool-result',
      toolUseId: 'call-1',
      toolName: 'Read',
      action: 'Read workspace files',
      isError: false,
      resultPreview: preview,
    });
    expect(completed.projection).not.toBeNull();
    const message: ToolActivityMessage = {
      type: 'tool.activity',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      ...completed.projection!,
    };
    expect(readHostMessage(message)).toEqual(message);
    const host = projectHostTranscriptMessage(
      createHostTranscriptState('complete'),
      message,
    );
    const recovered = parseRecoveryTranscript(host);
    expect(recovered?.transcript[0]).toMatchObject({
      resultPreview: preview,
      target: 'app.ts',
    });
    expect(parseSessionTranscript(host.transcript)?.[0]).toMatchObject({
      resultPreview: preview,
    });
    expect(upsertTool([], message)[0]).toMatchObject({ resultPreview: preview });
    const withCommandOutput = history([
      { ...tool(), outputTail: 'ephemeral command tail' },
    ]);
    const parsed = parseRecoveryTranscript(withCommandOutput);
    expect(parsed?.transcript[1]).not.toHaveProperty('outputTail');
    expect(parsed?.transcript[1]).toHaveProperty('resultPreview');
    expect(
      projectToolEvent(completed.state, {
        type: 'tool-result',
        toolUseId: 'call-1',
        toolName: 'Read',
        action: 'Read workspace files',
        isError: false,
        resultPreview: { ...preview, text: 'duplicate result' },
      }).projection,
    ).toBeNull();
  });

  it('retains newest snippets independently of answer text and persists eviction tombstones', () => {
    const answer: SessionTranscriptItem = {
      id: 'answer',
      kind: 'assistant',
      turnId: 'turn-1',
      text: 'A'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    };
    const tools = Array.from({ length: 20 }, (_, index) => ({
      ...tool(index),
      resultPreview: {
        ...preview,
        text: 'x'.repeat(8_000),
        source: { ...preview.source, callId: `call-${index}` },
      },
    }));
    const input = [answer, ...tools];
    const bounded = trimTranscriptToLimits(input);
    expect(bounded.transcript).toHaveLength(input.length);
    expect(bounded.transcript[0]).toBe(answer);
    expect(transcriptTextUnits(input)).toBe(transcriptTextUnits(bounded.transcript));
    const retained = bounded.transcript.flatMap((item) =>
      item.kind === 'tool' && item.resultPreview?.availability === 'available'
        ? [item.resultPreview.text]
        : [],
    );
    expect(retained.reduce((sum, text) => sum + text.length, 0)).toBe(
      MAX_CONVERSATION_TOOL_RESULT_UNITS,
    );
    expect(bounded.transcript[1]).toMatchObject({
      resultPreview: { availability: 'unavailable', reason: 'evicted' },
    });
    const parsed = parseRecoveryTranscript(history(bounded.transcript));
    expect(parsed?.transcript[2]).toMatchObject({ resultPreview: { reason: 'evicted' } });
    const direct = parseRecoveryTranscript(history(tools));
    expect(direct?.transcript[1]).toMatchObject({ resultPreview: { reason: 'evicted' } });
    const rest = enforceToolResultBudget(bounded.transcript);
    expect(rest.evicted).toBe(false);
    expect(rest.items).toBe(bounded.transcript);
    const historyTools = tools.map((item, index) => ({
      ...item,
      toolUseId: `history-call-${index}`,
    }));
    const savedHistory = parseRecoveryTranscript(
      history(enforceToolResultBudget(historyTools).items),
    );
    expect(savedHistory).toBeDefined();
    const refreshed = preserveToolResultPreviews(
      [historyTools[0]!],
      savedHistory!.transcript,
    );
    expect(refreshed[0]).toMatchObject({
      resultPreview: {
        availability: 'unavailable',
        reason: 'evicted',
        source: { callId: 'call-0' },
      },
    });
  });

  it('applies snippet-only eviction during live Host and webview updates without marking history partial', () => {
    let host = createHostTranscriptState('complete');
    let webview = assistantWebviewReducer(
      {
        ...initialAssistantWebviewState,
        sessionId: 'session-1',
        historyStatus: 'complete',
      },
      { type: 'turn.send', turnId: 'turn-1', text: 'Read files' },
    );
    for (let index = 0; index < 20; index += 1) {
      const { id: _id, kind: _kind, ...fields } = tool(index);
      const message: ToolActivityMessage = {
        ...fields,
        status: 'completed',
        type: 'tool.activity',
        sessionId: 'session-1',
        sequence: index + 1,
        resultPreview: {
          ...preview,
          source: { ...preview.source, callId: fields.toolUseId },
          text: 'x'.repeat(8_000),
        },
      };
      host = projectHostTranscriptMessage(host, message);
      webview = assistantWebviewReducer(webview, { type: 'host.message', message });
    }
    for (const state of [host, webview]) {
      const tools = state.transcript.filter((item) => item.kind === 'tool');
      expect(tools).toHaveLength(20);
      expect(tools[0]).toMatchObject({
        resultPreview: { availability: 'unavailable', reason: 'evicted' },
      });
      expect(
        tools.reduce(
          (sum, item) =>
            sum +
            (item.resultPreview?.availability === 'available'
              ? item.resultPreview.text.length
              : 0),
          0,
        ),
      ).toBe(MAX_CONVERSATION_TOOL_RESULT_UNITS);
      expect(state.historyStatus).toBe('complete');
      expect(state.truncated).toBe(false);
    }
    const restored = parseRecoveryTranscript(host);
    expect(restored?.transcript[0]).toMatchObject({
      resultPreview: { reason: 'evicted' },
    });
  });

  it('fills only a matching old invocation and never refills a saved or evicted result', () => {
    const { resultPreview: _preview, ...old } = tool();
    const loaded = { ...tool(), id: 'history-tool', toolUseId: 'history-call' };
    const enriched = ingestConversationHistory(history([old]), history([loaded]));
    expect(enriched.transcript[1]).toMatchObject({
      id: old.id,
      toolUseId: old.toolUseId,
      resultPreview: preview,
    });
    const unrelated = {
      ...loaded,
      resultPreview: { ...preview, source: { ...preview.source, callId: 'other-call' } },
    };
    expect(
      ingestConversationHistory(history([old]), history([unrelated])).transcript[1],
    ).not.toHaveProperty('resultPreview');
    const evicted = {
      ...tool(),
      resultPreview: { availability: 'unavailable' as const, reason: 'evicted' as const },
    };
    expect(
      ingestConversationHistory(history([evicted]), history([loaded])).transcript[1],
    ).toMatchObject({ resultPreview: evicted.resultPreview });
    expect(preserveToolResultPreviews([loaded], [evicted])[0]).toMatchObject({
      resultPreview: evicted.resultPreview,
    });
    expect(preserveToolResultPreviews([unrelated], [evicted])[0]).toMatchObject({
      resultPreview: unrelated.resultPreview,
    });
    const saved = { ...tool(), resultPreview: { ...preview, text: 'original return' } };
    expect(
      ingestConversationHistory(history([saved]), history([loaded])).transcript[1],
    ).toMatchObject({ resultPreview: saved.resultPreview });
  });

  it('rejects malformed snippets, accessor properties, extra keys and escaped source paths', () => {
    expect(isToolResultPreview(preview)).toBe(true);
    for (const invalid of [
      { ...preview, text: 'x'.repeat(8_001) },
      { ...preview, text: '\n'.repeat(120) },
      { ...preview, source: { ...preview.source, path: '../secret' } },
      { ...preview, rawInput: 'not allowed' },
      {
        ...preview,
        get text() {
          throw new Error('must not evaluate getters');
        },
      },
    ]) {
      expect(isToolResultPreview(invalid)).toBe(false);
      expect(
        parseSessionTranscript([{ ...tool(), resultPreview: invalid }]),
      ).toBeUndefined();
      expect(
        parseRecoveryTranscript(
          history([{ ...tool(), resultPreview: invalid } as ToolTranscriptItem]),
        ),
      ).toBeUndefined();
    }
  });
});
