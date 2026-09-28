import { useEffect, useRef } from 'react';
import { ArrowUp, Check, FileCode2, GitCompareArrows, MessageSquare, Pencil, RotateCcw, Square, X } from 'lucide-react';
import { ContentProvider } from '@droidvisx/chat-ui/content/context';
import { MAX_EDITOR_INSTRUCTION } from '../../shared/protocol/editorAssistanceProtocol';
import { Markdown } from '../content/Markdown';
import { Message, MessageContent } from '../ai-elements/message';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';
import { Textarea } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { useEditorAssistance, type EditorAssistanceTransport } from './useEditorAssistance';

const submitKey = /Mac|iPhone|iPad/u.test(navigator.platform) ? '⌘ Enter' : 'Ctrl+Enter';

export function EditorAssistanceApp({ transport }: { readonly transport: EditorAssistanceTransport }) {
  const state = useEditorAssistance(transport);
  const { snapshot, draft, setDraft, mode, theme, busy, canSubmit, submit, action, openAsk } = state;
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const selectionId = snapshot?.selectionId;
  useEffect(() => {
    if (!selectionId) return;
    input.current?.focus();
  }, [selectionId]);

  if (!snapshot) return <main className="editor-assistance-page">
    <div className="editor-assistance-loading" role="status"><DroidActivity phase="loading" />Opening selection…</div>
  </main>;
  const ask = mode === 'ask';
  const retry = snapshot.phase === 'error' || snapshot.phase === 'cancelled';
  const hasAnswer = snapshot.mode === 'ask' && snapshot.answer.length > 0;
  const readyEdit = snapshot.mode === 'edit' && snapshot.hasEdit;
  const applied = snapshot.phase === 'applied';
  const applying = snapshot.phase === 'applying';
  const isError = snapshot.phase === 'error';
  const stopping = snapshot.message === 'Stopping…';
  const status = applying ? 'Applying…' : busy ? snapshot.phase === 'running' && snapshot.message
    ? snapshot.message : ask ? 'Answering…' : 'Preparing changes…'
    : snapshot.message;
  const promptHelp = applied ? 'Select code to start another request.' : snapshot.sourceChanged
    ? 'Select the updated code and open Quick Edit or Ask again.'
    : ask ? 'Ask about the selection. Your file stays unchanged.'
      : 'Describe a change. Review the diff before accepting it.';

  return <ContentProvider value={{ workspaceRoot: null, theme }}>
    <main className="editor-assistance-page" aria-label="Droid editor assistance">
      <header className="editor-assistance-header">
        <Select value={mode} disabled={busy || snapshot.sourceChanged} onValueChange={(value) => { if (value === 'ask') openAsk(); }}>
          <SelectTrigger aria-label="Assistance mode" className="editor-assistance-mode">
            {ask ? <MessageSquare aria-hidden="true" /> : <Pencil aria-hidden="true" />}<SelectValue />
          </SelectTrigger>
          <SelectContent><SelectItem value="edit">Quick Edit</SelectItem><SelectItem value="ask">Ask</SelectItem></SelectContent>
        </Select>
        <span className="editor-assistance-model" title={snapshot.modelLabel}>{snapshot.modelLabel}</span>
      </header>
      <Button variant="ghost" size="none" className="editor-assistance-source"
        aria-label={`Show ${snapshot.fileLabel}, ${snapshot.rangeLabel}`} onClick={() => action('source')}>
        <FileCode2 aria-hidden="true" /><span className="editor-assistance-file" title={snapshot.fileLabel}>{snapshot.fileLabel}</span>
        <span className="editor-assistance-range">{snapshot.rangeLabel}</span>
      </Button>
      <form className="editor-assistance-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label htmlFor="editor-assistance-prompt" className="editor-assistance-prompt-label">
          {ask ? 'Question' : 'Edit instruction'}
        </label>
        <Textarea ref={input} id="editor-assistance-prompt" rows={3} value={draft}
          maxLength={MAX_EDITOR_INSTRUCTION} aria-describedby="editor-assistance-prompt-help"
          placeholder={ask ? 'What would you like to know about this code?' : 'What would you like to change?'}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape' && busy && !applying && !stopping) {
              event.preventDefault();
              event.stopPropagation();
              action('cancel');
            }
          }} />
        <div className="editor-assistance-composer-footer">
          <span className="editor-assistance-shortcut">
            <kbd>{submitKey}</kbd> to send
            {draft.length > MAX_EDITOR_INSTRUCTION - 500 ? <span> · {draft.length}/{MAX_EDITOR_INSTRUCTION}</span> : null}
          </span>
          {applying ? <Button variant="outline" disabled><DroidActivity />Applying…</Button>
            : busy ? <Button variant="outline" disabled={stopping} onClick={() => action('cancel')}>
            <Square aria-hidden="true" />{stopping ? 'Stopping…' : 'Stop'}
          </Button> : <Button type="submit" disabled={!canSubmit}>
            {retry ? <RotateCcw aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            {retry ? 'Retry' : ask ? 'Ask' : 'Generate edit'}
          </Button>}
        </div>
        <p id="editor-assistance-prompt-help" className="editor-assistance-help">{promptHelp}</p>
      </form>
      {snapshot.sourceChanged && !applied ? <p className="editor-assistance-notice" role="alert">
        The source has changed. This selection is out of date; accepting or generating changes is unavailable.
      </p> : null}
      {status ? <div className={`editor-assistance-status${isError ? ' editor-assistance-error' : ''}`}
        role={isError ? 'alert' : 'status'} aria-atomic="true">
        {busy ? <DroidActivity /> : applied ? <Check aria-hidden="true" /> : null}
        <span>{status}</span>
      </div> : null}
      {hasAnswer ? <section className="editor-assistance-answer" aria-label="Answer" aria-busy={busy}>
        <h1>Answer</h1><Message from="assistant"><MessageContent><Markdown text={snapshot.answer} streaming={busy} /></MessageContent></Message>
      </section> : null}
      {readyEdit ? <section className="editor-assistance-result" aria-label="Suggested changes">
        <div className="editor-assistance-result-copy"><GitCompareArrows aria-hidden="true" /><div>
          <h1>Suggested changes</h1><p>Your source file is unchanged until you accept.</p>
        </div></div>
        <div className="editor-assistance-edit-actions">
          <Button variant="outline" disabled={busy} onClick={() => action('review')}><GitCompareArrows aria-hidden="true" />Review Changes</Button>
          <Button disabled={!snapshot.canApply || snapshot.sourceChanged || busy} onClick={() => action('apply')}>
            <Check aria-hidden="true" />Accept
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => action('discard')}><X aria-hidden="true" />Discard</Button>
        </div>
      </section> : null}
    </main>
  </ContentProvider>;
}
