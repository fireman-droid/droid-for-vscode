import { useState } from 'react';
import { DiffView } from '@droidvisx/chat-ui/review/DiffView';
import { ReviewQuestions } from '../review/ReviewQuestions';
import { Button } from '../ui/button';
import { mountWebview } from '../shell/mount';
import type { BtwEntry } from '../../shared/protocol/btwProtocol';
import { parseReviewQuestionRequest } from '../../shared/protocol/reviewQuestionProtocol';
import '../theme.css';

// Local acceptance only: production UI with simulated state, no host or model connection.
const sessionId = 'question-fixture';
const entries: BtwEntry[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
const publish = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
const port = { postMessage(value: unknown) {
  const request = parseReviewQuestionRequest(value);
  if (!request) return;
  if (request.type === 'reviewQuestion.models') setTimeout(() => publish({ type: request.type, sessionId,
    status: 'ready', items: [{ id: 'fixture-model', label: 'Local simulation' }], selectedId: 'fixture-model', error: null }), 0);
  else if (request.type === 'reviewQuestion.close') { clearInterval(timer); entries.length = 0; }
  else if (request.type === 'reviewQuestion.ask') {
    clearInterval(timer);
    const entry = { id: crypto.randomUUID(), question: request.text, answer: '', state: 'streaming', message: null } as BtwEntry;
    entries.push(entry);
    const answer = '这段代码把接口数据转换成页面需要的任务对象。\n\n' +
      Array.from({ length: 12 }, (_, i) => `- 第 ${i + 1} 项：\`CURRENT_NODE\` 对应当前节点，\`steps\` 保存步骤；标点应紧接字段名。`).join('\n');
    let length = 0;
    const update = () => {
      length += 90;
      entries[entries.length - 1] = { ...entry, answer: answer.slice(0, length), state: length >= answer.length ? 'done' : 'streaming' };
      publish({ type: 'reviewQuestion.state', sessionId, questionId: request.questionId,
        state: { status: 'ready', entries: [...entries], message: null, pendingQuestion: null } });
      if (length >= answer.length) clearInterval(timer);
    };
    update(); timer = setInterval(update, 150);
  }
} };
const patch = ['@@ -1,60 +1,60 @@', ...Array.from({ length: 60 }, (_, i) =>
  i === 24 ? '-const current = task.current;\n+const current = task.CURRENT_NODE;' : ` const step_${i + 1} = ${i + 1};`)].join('\n');
function Fixture() {
  const [split, setSplit] = useState(false);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', gap: 8, padding: 8 }}>
      <Button size="sm" onClick={() => {
        const code = document.querySelector('.review-diff-code > code, .review-unified-row > code');
        if (!code) return;
        const range = document.createRange(); range.selectNodeContents(code);
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
        code.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }}>Select sample code</Button>
      <Button size="sm" onClick={() => setSplit(value => !value)}>Toggle split</Button>
      <Button size="sm" onClick={() => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.themePreference = theme;
        document.documentElement.style.colorScheme = theme;
      }}>Toggle theme</Button>
      <span>Local simulation · no model requests</span>
    </div>
    <main className="review-workbench" style={{ display: 'block', flex: 1, overflow: 'auto' }}>
      <ReviewQuestions port={port} sessionId={sessionId} scopeKey={String(split)} enabled>
        <DiffView patch={patch} path="src/task.ts" split={split} />
      </ReviewQuestions>
    </main>
  </div>;
}
mountWebview(<Fixture />, detail => { console.error(detail); });
