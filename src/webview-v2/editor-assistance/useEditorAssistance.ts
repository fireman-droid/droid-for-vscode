import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isEditorAssistanceHostMessage,
  MAX_EDITOR_INSTRUCTION,
  type EditorAssistanceMode,
  type EditorAssistanceRequest,
  type EditorAssistanceSnapshot,
} from '../../shared/protocol/editorAssistanceProtocol';
import { applyTheme } from '../shell/theme';
import { readBootThemePreference } from '../shell/themeController';

export interface EditorAssistanceTransport {
  postMessage(message: EditorAssistanceRequest): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

type Action = Extract<EditorAssistanceRequest, { type: 'editor-assistance.action' }>['action'];

export function useEditorAssistance(transport: EditorAssistanceTransport) {
  const [snapshot, setSnapshot] = useState<EditorAssistanceSnapshot | null>(null);
  const current = useRef<EditorAssistanceSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<EditorAssistanceMode>('edit');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.dvxTheme === 'light' ? 'light' : 'dark',
  );
  useEffect(() => {
    const unsubscribe = transport.subscribe((raw) => {
      if (!isEditorAssistanceHostMessage(raw)) return;
      if (raw.type === 'editor-assistance.theme') {
        applyTheme(readBootThemePreference(), raw.resolved);
        setTheme(raw.resolved);
        return;
      }
      const next = raw.snapshot;
      const previous = current.current;
      if (previous?.selectionId === next.selectionId && next.revision <= previous.revision) return;
      if (previous?.selectionId !== next.selectionId) {
        setDraft(next.instruction);
        setMode(next.mode);
      }
      current.current = next;
      sending.current = false;
      setPending(false);
      setSnapshot(next);
    });
    transport.postMessage({ type: 'editor-assistance.ready' });
    return unsubscribe;
  }, [transport]);

  const busy = pending || snapshot?.phase === 'running' || snapshot?.phase === 'applying';
  const canSubmit = snapshot !== null && !busy && !snapshot.sourceChanged &&
    draft.trim().length > 0 && draft.length <= MAX_EDITOR_INSTRUCTION;
  const submit = useCallback(() => {
    if (!canSubmit || !snapshot || sending.current) return;
    sending.current = true;
    setPending(true);
    transport.postMessage({
      type: 'editor-assistance.submit',
      selectionId: snapshot.selectionId,
      mode,
      instruction: draft.trim(),
    });
  }, [canSubmit, draft, mode, snapshot, transport]);
  const action = useCallback((value: Action) => {
    if (!snapshot) return;
    transport.postMessage({
      type: 'editor-assistance.action',
      selectionId: snapshot.selectionId,
      action: value,
    });
  }, [snapshot, transport]);
  return { snapshot, draft, setDraft, mode, setMode, theme, busy, canSubmit, submit, action };
}
