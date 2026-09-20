import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from '../../../packages/chat-ui/src/content/Markdown';

type Payload = { text: string; streaming: boolean; finished: boolean };
type LongTask = { duration: number; startTime: number };

function fixture(bytes: number) {
  const markers: string[] = [];
  let text = '';
  for (let index = 0; ; index += 1) {
    const marker = `SECTION_${String(index).padStart(4, '0')}`;
    const section = `## ${marker}\n\n` +
      `A local synthetic reply has **clear findings**, *qualified conclusions*, and \`src/example.ts\` references. ${'This paragraph explains the same local result without remote requests. '.repeat(5)}\n\n` +
      `- First finding for ${marker}\n- Second finding with [a local anchor](#${marker})\n\n` +
      `> A quoted observation for ${marker}.\n\n` +
      (index % 2 === 0 ? `\`\`\`typescript\nconst value${index} = ${index};\nconsole.log('CODE_${marker}', value${index});\n\`\`\`\n\n` : '') +
      (index % 3 === 0 ? `| Column | Result |\n| --- | --- |\n| ${marker} | Complete |\n\n` : '') +
      (index % 5 === 0 ? `Inline math $a^2 + b^2 = c^2$ and a display:\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n` : '');
    if (text.length + section.length + 100 > bytes) break;
    markers.push(marker);
    text += section;
  }
  const end = `\n\nEND_OF_COMPLETE_REPLY_${bytes}\n`;
  text += 'x'.repeat(bytes - text.length - end.length) + end;
  return { text, markers, end: end.trim() };
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

function summarize(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
    maxMs: sorted.at(-1) ?? 0, totalMs: values.reduce((sum, value) => sum + value, 0) };
}

let update: (payload: Payload) => void;
let committed: () => void = () => {};
function BenchmarkView() {
  const [payload, setPayload] = useState<Payload>({ text: '', streaming: false, finished: false });
  update = setPayload;
  useLayoutEffect(() => { if (payload.finished) committed(); }, [payload]);
  return <Markdown text={payload.text} streaming={payload.streaming} />;
}
const root = createRoot(document.getElementById('root')!);
root.render(<BenchmarkView />);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function run(bytes: number, mode: 'stream' | 'static') {
  await document.fonts.ready;
  await frame();
  update({ text: 'Warm up **local** Markdown with `code` and $x + 1$.', streaming: false, finished: false });
  await frame();
  await frame();
  update({ text: '', streaming: true, finished: false });
  await frame();
  await frame();
  const source = fixture(bytes);
  const tasks: LongTask[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) tasks.push({ duration: entry.duration, startTime: entry.startTime });
  });
  observer.observe({ type: 'longtask', buffered: false });
  const intervals: number[] = [];
  const deliveries: number[] = [];
  let previous = performance.now();
  let running = true;
  const sampleFrame = (time: number) => {
    if (!running) return;
    intervals.push(time - previous);
    previous = time;
    requestAnimationFrame(sampleFrame);
  };
  requestAnimationFrame(sampleFrame);
  const started = performance.now();
  let stopped = started;
  let lastChunk = started;
  const complete = new Promise<void>((resolve) => {
    committed = () => { void frame().then(frame).then(resolve); };
  });
  if (mode === 'static') {
    update({ text: source.text, streaming: false, finished: true });
  } else {
    await new Promise<void>((resolve) => {
      let length = 0;
      const timer = setInterval(() => {
        length = Math.min(bytes, length + 1024);
        lastChunk = performance.now();
        deliveries.push(lastChunk - started);
        update({ text: source.text.slice(0, length), streaming: true, finished: false });
        if (length === bytes) {
          clearInterval(timer);
          setTimeout(() => {
            stopped = performance.now();
            update({ text: source.text, streaming: false, finished: true });
            resolve();
          }, 50);
        }
      }, 50);
    });
  }
  await complete;
  const finished = performance.now();
  running = false;
  for (const entry of observer.takeRecords()) tasks.push({ duration: entry.duration, startTime: entry.startTime });
  observer.disconnect();
  const content = document.querySelector('.markdown-content')!;
  const visibleText = content.textContent ?? '';
  const computed = getComputedStyle(content);
  // React can retain style="" after incomplete KaTeX nodes lose inline styles.
  // Keep raw HTML; normalize only these observed, empty math styles for equality.
  const comparison = content.cloneNode(true) as HTMLElement;
  const emptyMathStyles = comparison.querySelectorAll('.katex [style=""], .katex-display[style=""]');
  emptyMathStyles.forEach((element) => element.removeAttribute('style'));
  return {
    rawHtml: content.innerHTML,
    bytes, mode, sourceHash: hash(source.text), totalMs: finished - started,
    feedMs: lastChunk - started, completionMs: finished - stopped,
    idealFeedMs: bytes / 1024 * 50, deliveredChunks: deliveries.length,
    deliveryMaxLagMs: Math.max(0, ...deliveries.map((time, index) => time - (index + 1) * 50)),
    longTasks: summarize(tasks.map((task) => task.duration)),
    blockingMs: tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
    frames: { ...summarize(intervals), over50Ms: intervals.filter((time) => time > 50).length },
    complete: visibleText.includes(source.end) && source.markers.every((marker) => visibleText.includes(marker)),
    environment: { fontFamily: computed.fontFamily, fontSize: computed.fontSize, lineHeight: computed.lineHeight,
      color: computed.color, width: content.getBoundingClientRect().width,
      theme: document.getElementById('root')!.dataset.theme, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches },
    content: { textHash: hash(visibleText), htmlHash: hash(content.innerHTML), comparisonHtmlHash: hash(comparison.innerHTML),
      emptyMathStyles: emptyMathStyles.length, textLength: visibleText.length,
      nodes: content.querySelectorAll('*').length, sections: content.querySelectorAll('h2').length,
      codeBlocks: content.querySelectorAll('pre').length, tables: content.querySelectorAll('table').length,
      math: content.querySelectorAll('.katex').length },
  };
}

Object.assign(window, { runMarkdownBenchmark: run });
