import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const MAX_EDITOR_INSTRUCTION = 8000;
export type EditorAssistanceMode = 'ask' | 'edit';
export type EditorAssistancePhase = 'idle' | 'running' | 'ready' | 'applying' | 'applied' | 'cancelled' | 'error';

export interface EditorAssistanceSnapshot {
  readonly selectionId: string;
  readonly revision: number;
  readonly mode: EditorAssistanceMode;
  readonly phase: EditorAssistancePhase;
  readonly fileLabel: string;
  readonly rangeLabel: string;
  readonly modelLabel: string;
  readonly instruction: string;
  readonly answer: string;
  readonly message: string;
  readonly sourceChanged: boolean;
  readonly canApply: boolean;
  readonly hasEdit: boolean;
}

export type EditorAssistanceRequest =
  | { readonly type: 'editor-assistance.ready' }
  | { readonly type: 'editor-assistance.submit'; readonly selectionId: string; readonly mode: EditorAssistanceMode; readonly instruction: string }
  | { readonly type: 'editor-assistance.openAsk'; readonly selectionId: string; readonly instruction: string }
  | { readonly type: 'editor-assistance.action'; readonly selectionId: string; readonly action: 'cancel' | 'review' | 'apply' | 'discard' | 'source' };

export type EditorAssistanceHostMessage =
  | { readonly type: 'editor-assistance.state'; readonly snapshot: EditorAssistanceSnapshot }
  | { readonly type: 'editor-assistance.theme'; readonly resolved: 'light' | 'dark' };

export function parseEditorAssistanceRequest(input: unknown): EditorAssistanceRequest | undefined {
  if (!isStrictRecord(input)) return undefined;
  if (input.type === 'editor-assistance.ready' && hasExactKeys(input, ['type'])) return { type: input.type };
  if (typeof input.selectionId !== 'string' || input.selectionId.length > 80 || !input.selectionId) return undefined;
  if (input.type === 'editor-assistance.openAsk' &&
      hasExactKeys(input, ['type', 'selectionId', 'instruction']) &&
      typeof input.instruction === 'string' && input.instruction.length <= MAX_EDITOR_INSTRUCTION) {
    return { type: input.type, selectionId: input.selectionId, instruction: input.instruction };
  }
  if (input.type === 'editor-assistance.submit' &&
      hasExactKeys(input, ['type', 'selectionId', 'mode', 'instruction']) &&
      (input.mode === 'ask' || input.mode === 'edit') &&
      typeof input.instruction === 'string' && input.instruction.trim().length > 0 &&
      input.instruction.length <= MAX_EDITOR_INSTRUCTION) {
    return { type: input.type, selectionId: input.selectionId, mode: input.mode, instruction: input.instruction };
  }
  if (input.type === 'editor-assistance.action' &&
      hasExactKeys(input, ['type', 'selectionId', 'action']) &&
      (input.action === 'cancel' || input.action === 'review' || input.action === 'apply' ||
       input.action === 'discard' || input.action === 'source')) {
    return { type: input.type, selectionId: input.selectionId, action: input.action };
  }
  return undefined;
}

export function isEditorAssistanceHostMessage(input: unknown): input is EditorAssistanceHostMessage {
  if (!isStrictRecord(input)) return false;
  if (input.type === 'editor-assistance.theme') return input.resolved === 'light' || input.resolved === 'dark';
  if (input.type !== 'editor-assistance.state' || !isStrictRecord(input.snapshot)) return false;
  const s = input.snapshot;
  return typeof s.selectionId === 'string' && Number.isSafeInteger(s.revision) &&
    (s.mode === 'ask' || s.mode === 'edit') &&
    ['idle', 'running', 'ready', 'applying', 'applied', 'cancelled', 'error'].includes(String(s.phase)) &&
    ['fileLabel', 'rangeLabel', 'modelLabel', 'instruction', 'answer', 'message'].every((key) => typeof s[key] === 'string') &&
    typeof s.sourceChanged === 'boolean' && typeof s.canApply === 'boolean' && typeof s.hasEdit === 'boolean';
}
