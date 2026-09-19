import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ComposerView, type ComposerLayout } from '@droidvisx/chat-ui/chat/ComposerView';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import type { useComposerFlow } from '../../webview/assistant/composer/useComposerFlow';
import { useCapabilityActions } from '../../webview/assistant/composer/useCapabilityActions';
import { useAttachmentActions } from '../../webview/assistant/attachments/useAttachmentActions';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import type { SlashNavTarget } from '../../webview/assistant/composer/slashBuiltins';
import { StagedAttachments } from './EditAttachments';
import { useAttachmentIngress } from './useAttachmentIngress';
import { ComposerSuggestions, useComposerSuggestions } from './ComposerSuggestions';
import { formatSelectionQuote, parseSelectionQuote } from '../../webview/assistant/btw/selectionQuote';

export function Composer({ state, port, flow, blocked, renderInputRow, onFileSearch, onNavigate, onBtwOpen }: {
  readonly state: AssistantWebviewState;
  readonly port: ChatPort;
  readonly flow: ReturnType<typeof useComposerFlow>;
  readonly blocked: boolean;
  readonly renderInputRow: (input: ReactNode, action: ReactNode) => ReactNode;
  readonly onFileSearch: (id: string, query: string) => void;
  readonly onNavigate: (page: SlashNavTarget) => void;
  readonly onBtwOpen: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const attachments = useAttachmentActions(port, state.sessionId, state.connection.status);
  const capabilities = useCapabilityActions({ vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status });
  const disabled = blocked || state.sessionId === null || state.connection.status !== 'connected' || state.interactions.length > 0;
  const ingress = useAttachmentIngress({
    owner: state.sessionId, conversationId: state.conversationId,
    resetKey: `${flow.sendSignal}:${flow.queueEditingId ?? 'composer'}`,
    count: state.attachments.length, disabled, onNotice: setNotice,
    actions: { image: attachments.handleAttachImage, pdf: attachments.handleAttachPdf, text: attachments.handleAttachTextFile, uris: attachments.handleAttachUris, remoteImage: attachments.handleAttachRemoteImage },
  });
  const suggestions = useComposerSuggestions({
    state, draft: flow.draft, disabled, onChange: flow.handleDraftChange,
    onFileSearch, onAttachPath: attachments.handleAttachPath,
    onCommandsRefresh: capabilities.handleCommandsRefresh, onSkillsRefresh: capabilities.handleSkillsRefresh,
    onNavigate, onBtwOpen,
  });
  useEffect(() => { suggestions.dismiss(); setNotice(null); }, [flow.sendSignal, flow.draftCommand.id]);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const reportLayout = useCallback((sample: ComposerLayout) => {
    port.postMessage({ type: 'webview.diagnostic', kind: 'perf-batch', detail: JSON.stringify({ source: 'composer.layout', sessionId: state.sessionId, ...sample }) });
  }, [port, state.sessionId]);
  const running = state.turn?.status === 'submitting' || state.turn?.status === 'streaming';
  const quote = parseSelectionQuote(flow.draft);
  const quotePrefixLength = quote ? flow.draft.length - quote.body.length : 0;
  const submit = () => { if (!flow.callbacks.isSendDisabled) void flow.callbacks.onSend(flow.draft); };
  return <ComposerView value={quote?.body ?? flow.draft} quote={quote?.quote} onQuoteClear={quote ? () => flow.handleDraftChange(quote.body) : undefined}
    onChange={(value, cursor) => suggestions.change(quote ? formatSelectionQuote(quote.quote, value) : value, cursor + quotePrefixLength)}
    onSend={submit} onStop={() => void flow.callbacks.onCancel()} running={running} sendDisabled={flow.callbacks.isSendDisabled}
    sendLabel={flow.queueEditingId !== null ? 'Save queued message' : state.turn?.status === 'stopping' || flow.queuedCount > 0 ? 'Queue message' : 'Send'}
    placeholder={state.transcript.length ? 'Add a follow up' : 'Ask Droid about your workspace'} maxLength={MAX_TURN_TEXT_LENGTH - quotePrefixLength}
    focusSignal={flow.draftCommand.id} notice={notice} onLayout={reportLayout}
    inputReplacement={state.interactions.length ? <p className="min-w-0 flex-1 text-xs text-muted-foreground">Answer Droid’s request to continue.</p> : undefined}
    attachments={<StagedAttachments attachments={state.attachments} images={state.attachmentImages} actions={attachments} disabled={disabled} />}
    suggestionsOpen={suggestions.open} onSuggestionsOpenChange={(open) => { if (!open) suggestions.dismiss(); }}
    suggestionsListId={suggestions.listId} activeSuggestionId={suggestions.activeId}
    suggestions={<ComposerSuggestions suggestions={suggestions} state={state} />}
    onKeyDown={(event) => {
      if (suggestions.onKeyDown(event)) { event.preventDefault(); return; }
      if (event.key === 'Escape' && flow.queueEditingId !== null) { event.preventDefault(); flow.handleQueueEditCancel(); }
    }}
    onPaste={ingress.onPaste} onDrop={ingress.onDrop} onDragOver={ingress.onDragOver} renderInputRow={renderInputRow} />;
}
