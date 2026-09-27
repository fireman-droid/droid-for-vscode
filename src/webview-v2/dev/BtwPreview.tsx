import { useEffect, useMemo, useState } from 'react';
import { MAX_BTW_ENTRIES, type BtwAskMessage, type BtwPrepareMessage, type BtwStopMessage, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ChatPort } from '../host/chatIntent';
import { ChatApp } from '../chat/ChatApp';
import { SideChatSheet } from '../chat/SideChatSheet';
import { useBtwPanel } from '../chat/btw/useBtwPanel';
import { Button } from '../ui/button';

const sample: SessionBtwState = {
  status: 'ready', message: null, pendingQuestion: null,
  entries: [
    {
      id: 'preview-context', state: 'done', message: null,
      question: '> Session ownership remains in the Extension Host.\n\n这句话具体是什么意思？',
      answer: '会话状态由 **Extension Host** 管理。界面只展示它发来的数据，并把你的操作交回去处理。\n\n这样切换视图或重新打开面板时，就不需要由两个地方分别维护同一段对话。',
    },
    {
      id: 'preview-follow-up', state: 'done', message: null,
      question: '那 BTW 会影响主对话吗？',
      answer: 'BTW 使用独立的侧问答会话，不会把这段追问写进主对话。\n\n- 可以继续阅读主对话，同时在这里追问。\n- 回答过程中可以先写下一条问题。\n- 关闭 BTW 仅隐藏面板，重新打开可继续草稿和侧问答。',
    },
  ],
};

export function BtwPreview({ port }: { readonly port: ChatPort }) {
  const [state, setState] = useState(sample);
  const previewPort = useMemo(() => ({ postMessage(message: BtwAskMessage | BtwPrepareMessage | BtwStopMessage) {
    if (message.type === 'btw.ask') setState((current) => ({
      ...current, status: 'ready', entries: [...current.entries, {
        id: `preview-${crypto.randomUUID()}`, question: message.text, modelId: message.modelId,
        images: message.images?.map(({ id, name, mediaType }) => ({ id, name, mediaType })),
        state: 'done' as const, message: null,
        answer: '这是用于检查布局、引用和输入操作的示例回复。真实回答由扩展中的 Droid 提供。',
      }].slice(-MAX_BTW_ENTRIES),
    }));
    if (message.type === 'btw.stop') setState((current) => ({ ...current, pendingQuestion: null,
      entries: current.entries.map((entry) => ({ ...entry, state: 'done' })) }));
  } }), []);
  const btw = useBtwPanel(previewPort, 'btw-preview', { state });
  useEffect(() => { btw.openWithQuote('保持主对话不变，单独解释这里的问题。'); }, [btw.openWithQuote]);
  return <div className="flex h-full min-w-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
      <span>BTW preview · 示例问答，不调用真实 Droid</span>
      <Button size="sm" variant="ghost" onClick={() => { setState(sample); btw.openPanel(); }}>Reset preview</Button>
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1"><ChatApp port={port} /></div>
      {btw.open ? <SideChatSheet state={state} draft={btw.draft} quotes={btw.quotes} width={btw.width}
        images={btw.images} selectedModel={btw.selectedModel} onModelChange={btw.setChosenModel}
        sending={btw.sending} notice={btw.notice} onDraftChange={btw.setDraft} onQuoteClear={btw.clearQuote}
        onQuoteRemove={btw.removeQuote} onWidthChange={btw.setWidth} onDismiss={btw.dismiss}
        onStop={btw.stop} onAsk={btw.sendDraft} /> : null}
    </div>
  </div>;
}
