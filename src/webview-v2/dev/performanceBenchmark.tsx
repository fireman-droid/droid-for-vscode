import { Profiler, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Transcript } from '../chat/Transcript';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
import { Markdown } from '../../../packages/chat-ui/src/content/Markdown';
import { Button } from '../../../packages/chat-ui/src/ui/button';
import { ComposerView } from '../../../packages/chat-ui/src/chat/ComposerView';
import { DiffView } from '../../../packages/chat-ui/src/review/DiffView';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const port = { postMessage() {}, getState: () => undefined, setState() {} };
const paragraph = 'A synthetic local reply with **findings**, `src/example.ts`, and ordinary prose. '.repeat(8);
const answer = (index: number) => `## Result ${index}\n\n${paragraph}\n\n- First observation\n- Second observation\n\n\`\`\`typescript\nconst item${index} = ${index};\n\`\`\`\n`;
const history: AssistantWebviewState = {
  ...initialAssistantWebviewState, conversationId: 'performance', sessionId: 'performance', connection: { status: 'connected' },
  transcript: Array.from({ length: 500 }, (_, index) => [
    { kind: 'user' as const, id: `q-${index}`, messageId: `message-${index}`, text: `Synthetic question ${index}` },
    { kind: 'assistant' as const, id: `a-${index}`, turnId: `turn-${index}`, text: answer(index) },
  ]).flat(),
};
const otherHistory: AssistantWebviewState = {
  ...history, conversationId: 'performance-other', sessionId: 'performance-other',
  transcript: history.transcript.map((item) => item.kind === 'user' || item.kind === 'assistant'
    ? { ...item, id: `other-${item.id}`, text: `${item.text}\n\nOTHER_SESSION` } : item),
};
const diffPatch = `@@ -1,2000 +1,2000 @@\n${Array.from({ length: 2000 }, (_, index) => `-const before${index} = { id: ${index}, label: "Original synthetic entry" };`).join('\n')}\n${Array.from({ length: 2000 }, (_, index) => `+const after${index} = { id: ${index}, label: "Updated synthetic entry" };`).join('\n')}`;
const scenarios = ['Long chat mount', 'Long chat switch', 'Scroll history', 'Stream in long chat', 'Markdown 4 KiB', 'Markdown 8 KiB', 'Long diff open', 'Long diff scroll', 'Long diff split'];
type Sample = { name: string; totalMs: number; commits: number; renderMs: number; maxRenderMs: number;
  longTasks: number; blockingMs: number; frameP95Ms: number; frameMaxMs: number; mountedRows: number; diffRows: number; nodes: number; complete: boolean };
let recordRender: ((duration: number) => void) | undefined;

function Benchmark() {
  const [state, setState] = useState<AssistantWebviewState | null>(null);
  const [markdown, setMarkdown] = useState<{ text: string; streaming: boolean } | null>(null);
  const [diff, setDiff] = useState<{ split: boolean } | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const inputStarted = useRef(0);
  const [inputResult, setInputResult] = useState('Paste synthetic content to measure the production composer.');
  const settle = async () => {
    const deadline = performance.now() + 30_000;
    await frame(); await frame();
    while (document.querySelector('[data-markdown-pending]')) {
      if (performance.now() > deadline) throw new Error('Rendering did not finish within 30 seconds.');
      await frame();
    }
    await frame();
  };
  const run = async (name: string) => {
    if (busy) return;
    setBusy(true); setError('');
    setState(null); setMarkdown(null); setDiff(null);
    await frame(); await frame();
    if (name === 'Long chat switch') { setState(history); await settle(); }
    const frames: number[] = [], tasks: number[] = [], renders: number[] = [];
    let sampling = true, previous = performance.now();
    const tick = (time: number) => { if (!sampling) return; frames.push(time - previous); previous = time; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration); });
    observer.observe({ type: 'longtask' });
    recordRender = (duration) => renders.push(duration);
    const started = performance.now();
    try {
      let complete = false;
      if (name === 'Long chat mount' || name === 'Long chat switch' || name === 'Scroll history' || name === 'Stream in long chat') {
        setState(name === 'Long chat switch' ? otherHistory : history);
        await settle();
        const viewport = document.querySelector<HTMLElement>('[aria-label="Chat transcript"]')!;
        if (name === 'Scroll history') {
          // Same scroll container and native scroll events as wheel movement.
          viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
          for (let index = 0; index < 90; index++) {
            viewport.scrollTop = Math.max(0, viewport.scrollTop - 55);
            await frame();
          }
        } else if (name === 'Stream in long chat') {
          const prefix = history.transcript.slice(0, -1);
          let text = '';
          for (let index = 0; index < 160; index++) {
            text += index % 12 === 0 ? '\n\n**Progress** ' : 'incremental text ';
            setState({ ...history, turn: { turnId: 'turn-499', status: 'streaming' },
              transcript: [...prefix, { kind: 'assistant', id: 'a-499', turnId: 'turn-499', text }] });
            await frame();
          }
          setState({ ...history, transcript: [...prefix, { kind: 'assistant', id: 'a-499', turnId: 'turn-499', text: `${text}\n\nSTREAM_COMPLETE` }] });
          await settle();
        }
        complete = name === 'Stream in long chat' ? viewport.textContent!.includes('STREAM_COMPLETE')
          : name === 'Long chat switch' ? viewport.textContent!.includes('OTHER_SESSION')
          : viewport.scrollHeight > viewport.clientHeight && document.querySelectorAll('[data-markdown-row]').length > 0;
      } else if (name.startsWith('Long diff')) {
        setDiff({ split: false });
        await settle();
        const viewport = document.querySelector<HTMLElement>('[aria-label="Performance diff viewport"]')!;
        if (name === 'Long diff scroll') {
          viewport.scrollTop = viewport.scrollHeight;
          await settle();
        } else if (name === 'Long diff split') {
          setDiff({ split: true });
          await settle();
        }
        const text = viewport.textContent ?? '';
        // The hidden width sizer includes the patch: only real code rows prove a reveal.
        const code = [...viewport.querySelectorAll('code')].map((element) => element.textContent).join('\n');
        complete = name === 'Long diff scroll' ? code.includes('const after1999')
          : name === 'Long diff split' ? code.includes('const before0') && code.includes('const after0')
          : code.includes('const before0') && text.includes('@@ -1,2000 +1,2000 @@');
      } else {
        const size = name === 'Markdown 8 KiB' ? 8192 : 4096;
        const text = answer(0).repeat(20).slice(0, size) + '\n\nMARKDOWN_COMPLETE';
        for (let length = 128; length < text.length; length += 128) {
          setMarkdown({ text: text.slice(0, length), streaming: true });
          await frame();
        }
        setMarkdown({ text, streaming: false });
        await settle();
        complete = document.querySelector('.markdown-content')?.textContent?.includes('MARKDOWN_COMPLETE') === true;
      }
      sampling = false;
      tasks.push(...observer.takeRecords().map((entry) => entry.duration));
      frames.sort((a, b) => a - b);
      setSamples((previous) => [...previous, { name, totalMs: performance.now() - started,
        commits: renders.length, renderMs: renders.reduce((a, b) => a + b, 0), maxRenderMs: Math.max(0, ...renders),
        longTasks: tasks.length, blockingMs: tasks.reduce((sum, value) => sum + Math.max(0, value - 50), 0),
        frameP95Ms: frames[Math.max(0, Math.ceil(frames.length * .95) - 1)] ?? 0, frameMaxMs: frames.at(-1) ?? 0,
        mountedRows: document.querySelectorAll('[data-markdown-row]').length,
        diffRows: document.querySelectorAll('.review-unified-row, .review-split-row').length,
        nodes: document.querySelectorAll('#benchmark-content *').length, complete }]);
    } catch (cause) { setError(String(cause)); }
    finally { sampling = false; recordRender = undefined; observer.disconnect(); setBusy(false); }
  };
  return <main className="grid h-screen grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-2 p-3">
    <nav className="flex flex-wrap gap-2">{scenarios.map((name) =>
      <Button key={name} size="sm" variant="outline" disabled={busy} onClick={() => void run(name)}>{name}</Button>)}</nav>
    <section><p role="status">{busy ? 'Measuring…' : error || 'Ready'}</p>
      <pre id="benchmark-results" className="max-h-40 overflow-auto text-xs">{JSON.stringify(samples, null, 2)}</pre></section>
    <div id="benchmark-content" className="grid min-h-0 overflow-hidden">
      <Profiler id="transcript" onRender={(_id, _phase, duration) => recordRender?.(duration)}>
        {state ? <Transcript state={state} port={port} blocked={false} sendSignal={0} onFork={undefined} /> : null}
        {markdown ? <div className="overflow-auto"><Markdown text={markdown.text} streaming={markdown.streaming} /></div> : null}
        {diff ? <div aria-label="Performance diff viewport" className="min-h-0 overflow-auto"><DiffView patch={diffPatch} path="synthetic-large.ts" split={diff.split} /></div> : null}
      </Profiler>
    </div>
    <footer><ComposerView value={draft} onSend={() => {}} maxLength={131072} placeholder="Performance input"
      onPaste={() => { inputStarted.current = performance.now(); }}
      onChange={(value) => {
        const started = inputStarted.current || performance.now();
        inputStarted.current = 0;
        setDraft(value);
        void frame().then(frame).then(() => {
          const input = document.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
          setInputResult(JSON.stringify({ characters: input.value.length, pasteToPaintMs: performance.now() - started,
            height: input.getBoundingClientRect().height, scrollHeight: input.scrollHeight, complete: input.value === value }));
        });
      }} /><pre id="input-results" className="text-xs">{inputResult}</pre></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Benchmark />);
