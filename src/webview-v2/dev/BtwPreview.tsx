import { useState } from 'react';
import { EMPTY_SESSION_BTW_STATE, MAX_BTW_ENTRIES, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { ChatApp } from '../chat/ChatApp';
import { SideChatSheet } from '../chat/SideChatSheet';
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
      answer: 'BTW 使用独立的侧问答会话，不会把这段追问写进主对话。\n\n- 可以继续阅读主对话，同时在这里追问。\n- 回答过程中可以先写下一条问题。\n- 关闭 BTW 会清空这段侧问答。',
    },
  ],
};

export function BtwPreview({ port }: { readonly port: ChatPort }) {
  const [state, setState] = useState(sample);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState<string | null>('保持主对话不变，单独解释这里的问题。');
  const [width, setWidth] = useState(320);
  return <div className="flex h-full min-w-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
      <span>BTW preview · 示例问答，不调用真实 Droid</span>
      <Button size="sm" variant="ghost" onClick={() => { setState(sample); setOpen(true); }}>Reset preview</Button>
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1"><ChatApp port={port} /></div>
      {open ? <SideChatSheet state={state} draft={draft} quote={quote} width={width}
        onDraftChange={setDraft} onQuoteClear={() => setQuote(null)} onWidthChange={setWidth}
        onDismiss={() => { setOpen(false); setState(EMPTY_SESSION_BTW_STATE); }}
        onStop={() => setState((current) => ({ ...current, pendingQuestion: null, entries: current.entries.map((entry) => ({ ...entry, state: 'done' })) }))}
        onAsk={(question) => setState((current) => ({
          ...current, status: 'ready', entries: [...current.entries, {
            id: `preview-${crypto.randomUUID()}`, question, state: 'done' as const, message: null,
            answer: '这是用于检查布局、引用和输入操作的示例回复。真实回答由扩展中的 Droid 提供。',
          }].slice(-MAX_BTW_ENTRIES),
        }))} /> : null}
    </div>
  </div>;
}
