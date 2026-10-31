import {
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_THINKING_LENGTH,
  MAX_BTW_ENTRIES,
  type BtwEntryPart,
  type BtwEntryProgress,
  type BtwStatus,
  type SessionBtwState,
  type BtwAskOptions,
} from '../../shared/protocol/btwProtocol';
import { btwImageSummaries } from '../../shared/protocol/btwAttachments';
import type { BtwThinkingEvent } from '../../runtime/btw/btwThinking';
import { retainBtwTools, type BtwToolActivity } from '../../shared/protocol/btwToolActivity';

export function applyBtwTool(state: SessionBtwState, id: string, tool: BtwToolActivity): SessionBtwState {
  return { ...state, entries: state.entries.map(entry => {
    if (entry.id !== id || entry.state !== 'streaming') return entry;
    const tools = [...entry.tools ?? []];
    const index = tools.findIndex(item => item.id === tool.id);
    if (index < 0) tools.push(tool); else tools[index] = tool;
    const retained = retainBtwTools(tools);
    const parts = index < 0 ? [...entry.parts ?? [], { kind: 'tool' as const, id: tool.id }] : entry.parts ?? [];
    return { ...entry, tools: retained, parts: retainParts(parts, retained), progress: tool.state === 'running' ? 'tool' as const
      : entry.progress === 'tool' ? 'waiting' as const : entry.progress };
  }) };
}

/** Drops parts of evicted tools; text parts left adjacent merge into the earlier one. */
function retainParts(parts: readonly BtwEntryPart[], tools: readonly BtwToolActivity[]): readonly BtwEntryPart[] {
  const ids = new Set(tools.map(tool => tool.id));
  const kept: BtwEntryPart[] = [];
  for (const part of parts) {
    if (part.kind === 'tool' && !ids.has(part.id)) continue;
    if (part.kind === 'text' && kept.at(-1)?.kind === 'text') continue;
    kept.push(part);
  }
  return kept;
}

function settleTools(tools: readonly BtwToolActivity[] | undefined): readonly BtwToolActivity[] | undefined {
  return tools?.map(tool => tool.state === 'running' ? { ...tool, state: 'incomplete' as const } : tool);
}

/**
 * Pure bounded projection of the `/btw` side-chat card the host
 * mirrors to the webview (side-question-design.md §5.3). The card is
 * ephemeral — never part of recovery snapshots — so these helpers
 * only guard the wire bounds: the entry cap drops the oldest Q&A
 * pairs and answers stop growing at the answer cap.
 */

export function setBtwStatus(
  state: SessionBtwState,
  status: BtwStatus,
  message: string | null = null,
): SessionBtwState {
  return { ...state, status, message };
}

/** Replaces or clears the card's single pending follow-up. */
export function setBtwPendingQuestion(
  state: SessionBtwState,
  pendingQuestion: string | null,
  options: BtwAskOptions = {},
): SessionBtwState {
  const { pendingImages: _images, pendingModelId: _model, pendingReasoningEffort: _effort, ...rest } = state;
  return { ...rest, pendingQuestion, ...(options.images?.length ? { pendingImages: btwImageSummaries(options.images) } : {}),
    ...(options.modelId === undefined ? {} : { pendingModelId: options.modelId }),
    ...(options.reasoningEffort === undefined ? {} : { pendingReasoningEffort: options.reasoningEffort }) };
}

/** Appends one streaming question, evicting the oldest beyond cap. */
export function appendBtwQuestion(
  state: SessionBtwState,
  id: string,
  question: string,
  options: BtwAskOptions = {},
): SessionBtwState {
  const entries = [
    ...state.entries,
    {
      id,
      question,
      ...(options.images?.length ? { images: btwImageSummaries(options.images) } : {}),
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      answer: '',
      state: 'streaming' as const,
      progress: 'waiting' as const,
      message: null,
    },
  ];
  return {
    ...state,
    entries:
      entries.length > MAX_BTW_ENTRIES
        ? entries.slice(entries.length - MAX_BTW_ENTRIES)
        : entries,
  };
}

export function setBtwEntryProgress(
  state: SessionBtwState,
  id: string,
  progress: BtwEntryProgress,
): SessionBtwState {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id || entry.state !== 'streaming' || entry.progress === progress) {
      return entry;
    }
    changed = true;
    return { ...entry, progress };
  });
  return changed ? { ...state, entries } : state;
}

/** Grows one entry's answer, truncating at the answer cap. */
export function appendBtwAnswerDelta(
  state: SessionBtwState,
  id: string,
  text: string,
): SessionBtwState {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id || entry.answer.length >= MAX_BTW_ANSWER_LENGTH) {
      return entry;
    }
    changed = true;
    const parts = entry.parts ?? [];
    return {
      ...entry,
      answer: (entry.answer + text).slice(0, MAX_BTW_ANSWER_LENGTH),
      parts: text.length === 0 || parts.at(-1)?.kind === 'text' ? parts : [...parts, { kind: 'text' as const, start: entry.answer.length }],
      progress: 'answering' as const,
    };
  });
  return changed ? { ...state, entries } : state;
}

/** Updates known thinking blocks in place and appends new ones where they began, including textless blocks. */
export function applyBtwThinking(state: SessionBtwState, id: string, event: BtwThinkingEvent): SessionBtwState {
  return { ...state, entries: state.entries.map((entry) => {
    if (entry.id !== id || entry.state !== 'streaming') return entry;
    const parts = [...entry.parts ?? []];
    let budget = MAX_BTW_THINKING_LENGTH;
    for (const block of event.blocks) {
      const text = block.text.slice(0, budget);
      budget -= text.length;
      const part: BtwEntryPart = { kind: 'thinking', id: block.id, text, active: block.active,
        truncated: block.truncated || text.length < block.text.length,
        ...(block.durationMs === undefined ? {} : { durationMs: block.durationMs }) };
      const index = parts.findIndex(item => item.kind === 'thinking' && item.id === block.id);
      if (index < 0) parts.push(part); else parts[index] = part;
    }
    const active = event.blocks.some(block => block.active);
    return { ...entry, parts,
      progress: active ? 'thinking' as const : entry.progress === 'thinking' ? 'waiting' as const : entry.progress };
  }) };
}

export function completeBtwEntry(state: SessionBtwState, id: string, stopped = false): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const { progress: _progress, ...settled } = entry;
      return { ...settled, ...(entry.tools ? { tools: settleTools(entry.tools) } : {}), state: 'done' as const, ...(stopped ? { stopped: true } : {}) };
    }),
  };
}

export function failBtwEntry(
  state: SessionBtwState,
  id: string,
  message: string,
): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const { progress: _progress, ...settled } = entry;
      return { ...settled, ...(entry.tools ? { tools: settleTools(entry.tools) } : {}), state: 'error' as const, message };
    }),
  };
}
