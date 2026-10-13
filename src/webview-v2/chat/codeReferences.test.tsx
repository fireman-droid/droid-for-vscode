// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider, type UiEnvironment } from '../../../packages/chat-ui/src/environment';
import { Textarea } from '../../../packages/chat-ui/src/ui/input';
import { CodeReferenceChips } from '../../../packages/chat-ui/src/chat/CodeReferenceChips';
import { CODE_REFERENCE_MIME, EDITOR_COPY_MIME, formatCodeReferences, parseCodeReferences, type CodeReference } from '../../../packages/chat-ui/src/chat/codeReferences';
import { useCodeReferenceDraft } from '../../../packages/chat-ui/src/chat/useCodeReferenceDraft';
import { InlineQuestion } from '../../../packages/chat-ui/src/review/InlineQuestion';
import { SideChatSheet } from '../../../packages/chat-ui/src/chat/SideChatSheet';
import { QuestionCardView } from '../../../packages/chat-ui/src/chat/QuestionCardView';
import { TooltipProvider } from '../../../packages/chat-ui/src/ui/overlays';

afterEach(cleanup);
const reference: CodeReference = { path: 'C:/project/文件.vue', startLine: 1, endLine: 3, text: '  const x = "中文🙂";\n```\n', side: 'after' };
const env: UiEnvironment = { assistantName: 'Droid', copyText: async () => undefined, openCodeReference: vi.fn() };
const clipboard = (ref = reference) => ({ files: [], getData: (type: string) => type === CODE_REFERENCE_MIME ? JSON.stringify(ref) : type === 'text/plain' ? ref.text : '' });

it('round-trips exact snapshots, embedded fences, whitespace, multiple references and trimmed reference-only sends', () => {
  const value = formatCodeReferences([reference, { ...reference, path: 'other.ts' }], '  explain\n');
  expect(parseCodeReferences(value)).toEqual({ references: [reference, { ...reference, path: 'other.ts' }], body: '  explain\n' });
  expect(parseCodeReferences(formatCodeReferences([reference], '').trim())).toEqual({ references: [reference], body: '' });
  const ordinary = '```typescript\nconst x = 1;\n```';
  expect(parseCodeReferences(ordinary)).toEqual({ references: [], body: ordinary });
});

function Draft({ environment = env, owner = 'one' }: { environment?: UiEnvironment; owner?: string }) {
  return <UiEnvironmentProvider value={environment}><DraftInput owner={owner} /></UiEnvironmentProvider>;
}
function DraftInput({ owner }: { owner: string }) {
  const [value, setValue] = useState('Explain this');
  const draft = useCodeReferenceDraft(value, setValue, 4000, owner);
  return <><Textarea aria-label="Draft" value={draft.body} onChange={e => draft.change(e.target.value)} onPaste={draft.onPaste} />
    <CodeReferenceChips references={draft.references} onRemove={draft.remove} /><output>{value}</output></>;
}

it('folds only matching code metadata, opens the exact reference and removes it without losing the question', () => {
  render(<Draft />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  input.setSelectionRange(0, 0);
  fireEvent.paste(input, { clipboardData: clipboard() });
  expect(input.value).toBe('Explain this');
  fireEvent.click(screen.getByRole('button', { name: 'Open 文件.vue (1–3)' }));
  expect(env.openCodeReference).toHaveBeenCalledWith(reference);
  fireEvent.click(screen.getByRole('button', { name: 'Remove 文件.vue (1–3)' }));
  expect(screen.getByRole('status').textContent).toBe('Explain this');
  fireEvent.paste(input, { clipboardData: { getData: (type: string) => type === CODE_REFERENCE_MIME ? JSON.stringify(reference) : 'unrelated text' } });
  expect(screen.queryByRole('button', { name: 'Open 文件.vue (1–3)' })).toBeNull();
});

it.each(['edit', 'owner', 'failure', 'success'])('retains plain pasted text during host resolution: %s', async outcome => {
  let finish!: (ref: CodeReference | null) => void;
  const resolveCodeReference = vi.fn(() => new Promise<CodeReference | null>(resolve => { finish = resolve; }));
  const environment = { ...env, resolveCodeReference };
  const view = render(<Draft environment={environment} />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  input.setSelectionRange(0, 0);
  fireEvent.paste(input, { clipboardData: { getData: (type: string) => type === 'text/plain' ? reference.text : type === EDITOR_COPY_MIME
    ? JSON.stringify({ providerCopyMimeTypes: ['application/vnd.droid.copy.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }) : '' } });
  expect(input.value).toBe(reference.text + 'Explain this');
  if (outcome === 'edit') fireEvent.change(input, { target: { value: input.value + ' keep my edit' } });
  if (outcome === 'owner') view.rerender(<Draft environment={environment} owner="two" />);
  await act(async () => finish(outcome === 'failure' ? null : reference));
  expect(screen.queryByRole('button', { name: 'Open 文件.vue (1–3)' }) !== null).toBe(outcome === 'success');
  expect(input.value).toBe(outcome === 'success' ? 'Explain this' : reference.text + 'Explain this' + (outcome === 'edit' ? ' keep my edit' : ''));
});

it.each(['review', 'btw'])('sends a complete snapshot from %s while keeping its input compact', surface => {
  const send = vi.fn();
  function Conversation() {
    const [draft, setDraft] = useState('Explain this');
    return surface === 'review' ? <InlineQuestion entries={[]} draft={draft} onDraft={setDraft} busy={false} disabled={false} message={null}
      onSend={() => send(draft)} onStop={vi.fn()} onClose={vi.fn()} maxLength={4000} focusRequested={false} onFocused={vi.fn()} />
      : <SideChatSheet state={{ status: 'ready', entries: [], message: null, pendingQuestion: null }} draft={draft} onDraftChange={setDraft}
        width={400} maxTextLength={4000} onQuoteClear={vi.fn()} onWidthChange={vi.fn()} onDismiss={vi.fn()} onAsk={send} onStop={vi.fn()} />;
  }
  render(<UiEnvironmentProvider value={env}><Conversation /></UiEnvironmentProvider>);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  input.setSelectionRange(0, 0);
  fireEvent.paste(input, { clipboardData: clipboard() });
  expect(input.value).toBe('Explain this');
  fireEvent.click(screen.getByRole('button', { name: surface === 'review' ? 'Send question' : 'Send side question' }));
  expect(parseCodeReferences(send.mock.calls[0]![0])).toEqual({ references: [reference], body: 'Explain this' });
});

it('keeps code references when reopening a sent message for editing and resending', () => {
  const initial = formatCodeReferences([reference], 'Explain this');
  const resend = vi.fn();
  function Question() {
    const [draft, setDraft] = useState<{ messageId: string; text: string; phase: 'editing'; notice: null } | null>(null);
    return <QuestionCardView item={{ id: 'question', messageId: 'message', text: initial }}
      editor={{ draft, selection: { current: null }, begin: (messageId, text) => setDraft({ messageId, text, phase: 'editing', notice: null }), cancel: () => setDraft(null),
        update: (_, patch) => setDraft(previous => previous ? { ...previous, ...patch } : null) }} canResend maxLength={4000} onResend={() => resend(draft?.text)} />;
  }
  render(<UiEnvironmentProvider value={env}><TooltipProvider><Question /></TooltipProvider></UiEnvironmentProvider>);
  expect(screen.getByRole('button', { name: 'Open 文件.vue (1–3)' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain another detail' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(parseCodeReferences(resend.mock.calls[0]![0])).toEqual({ references: [reference], body: 'Explain another detail' });
});
