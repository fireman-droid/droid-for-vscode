import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DiffView } from '../../../packages/chat-ui/src/review/DiffView';
import { runReviewAppBenchmark } from './reviewAppBenchmark';

// Isolated synthetic fixtures for the production diff renderer; no Host or model.
const root = createRoot(document.getElementById('root')!);
let generation = 0;
let lineCount = 0;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle(frames = 3) { for (let index = 0; index < frames; index++) await frame(); }
function viewport() { return document.querySelector<HTMLElement>('.review-code-scroll')!; }
function codes() { return [...document.querySelectorAll<HTMLElement>('.review-diff code')]; }
function snapshot() {
  const scroll = viewport();
  return { scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop, viewportHeight: scroll.clientHeight,
    mountedLines: codes().length, totalElements: document.querySelectorAll('*').length };
}
function fixture(count: number, scattered: boolean) {
  const lines: string[] = [`@@ -1,${count} +1,${count} @@`];
  for (let index = 0; index < count; index++) {
    const text = index === 2 ? `// ${'long line '.repeat(50)}中文\tLONG_LINE_END`
      : `const row_${String(index).padStart(5, '0')} = updateCar(position, speed, deltaTime);`;
    if ((scattered && index % 2 === 0 && index !== 2) || [0, Math.floor(count / 2), count - 1].includes(index)) lines.push(`-${text.replace('updateCar', 'moveCar')}`, `+${text}`);
    else lines.push(` ${text}`);
  }
  return lines.join('\n');
}
function readableScreenshotPatch() {
  const lines = [
    ...Array.from({ length: 560 }, (_, index) => ` // Racing simulation context line ${index + 1}`),
    ' function updateCar(dt) {', '   const previousSpeed = speed;', '   const acceleration = input.throttle * ENGINE_POWER;',
    '   speed += acceleration * dt;', '   steering = Math.max(-1, Math.min(1, input.steering));',
    '-  const grip = 0.12;', '+  const grip = lerp(0.12, 0.38, speed / MAX_SPEED);',
    '-  car.rotation.y += steering * dt;', '+  const turnRate = steering * grip * dt;', '+  car.rotation.y += turnRate;',
    '+  camera.lookAt(car.position);', '   car.position.x += Math.sin(car.rotation.y) * speed * dt;',
    '   car.position.z += Math.cos(car.rotation.y) * speed * dt;', '   updateWheels(speed, steering);',
    '   updateCheckpoint(car.position);', ' }', ' ', ' function updateCamera() {',
    '-  camera.position.copy(car.position);', '+  const target = car.position.clone().add(cameraOffset);',
    '+  camera.position.lerp(target, 0.08);', '   camera.lookAt(car.position);', ' }',
    ...Array.from({ length: 24 }, (_, index) => ` const frame_${index} = updateCar(deltaTime);`),
  ];
  return `@@ -1,${lines.filter((line) => !line.startsWith('+')).length} +1,${lines.filter((line) => !line.startsWith('-')).length} @@\n${lines.join('\n')}`;
}
async function mount(count: number, split: boolean, theme: 'dark' | 'light' | 'auto', readable = false, scattered = false) {
  lineCount = count;
  document.documentElement.dataset.theme = theme === 'auto' ? 'dark' : theme;
  document.documentElement.dataset.themePreference = theme === 'auto' ? 'auto' : theme;
  document.documentElement.style.setProperty('--vscode-editor-background', '#232638');
  document.documentElement.style.setProperty('--vscode-editor-foreground', '#bbc4e8');
  document.getElementById('root')!.className = '';
  const start = performance.now();
  const patch = readable ? readableScreenshotPatch() : fixture(count, scattered);
  flushSync(() => root.render(<main key={++generation} className="review-workbench">
    <header className="review-topbar"><strong className="review-title">Review</strong><span>Recorded edits</span></header>
    <div className="review-body"><section className="review-code">
      <header className="review-file-toolbar"><strong>racing-3d.html</strong><span className="review-top-spacer" /><span>Full file · {split ? 'Split' : 'Unified'}</span></header>
      <div className="review-code-scroll"><div className="review-recorded-patch">
        <DiffView patch={patch} path="racing-3d.ts" split={split} />
      </div></div>
    </section></div>
  </main>));
  await settle(4);
  if (readable) { viewport().scrollTop = 548 * 22; await settle(); }
  return { ...snapshot(), mountMs: performance.now() - start };
}
async function sweep() {
  const first = snapshot();
  const heights: number[] = [], mounted: number[] = [], frames: number[] = [];
  const points: Record<string, unknown>[] = [];
  const scroll = viewport();
  let headerSticky = true;
  for (const [label, fraction, marker] of [['first', 0, 0], ['middle', .5, Math.floor(lineCount / 2)], ['last', 1, lineCount - 1], ['first-again', 0, 0]] as const) {
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * fraction;
    await settle();
    points.push({ label, ...snapshot(), reachable: codes().some((code) => code.textContent?.includes(`row_${String(marker).padStart(5, '0')}`)) });
  }
  for (let index = 0; index <= 50; index++) {
    const start = performance.now();
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * index / 50;
    await settle(2);
    frames.push(performance.now() - start);
    const sample = snapshot();
    const heading = document.querySelector('.review-split-labels');
    if (heading && Math.abs(heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top) > 1) headerSticky = false;
    heights.push(sample.scrollHeight); mounted.push(sample.mountedLines);
  }
  scroll.scrollTop = 0;
  await settle();
  return { first, points, headerSticky, maxMountedLines: Math.max(...mounted), stableScrollHeight: heights.every((height) => height === first.scrollHeight),
    minHeight: Math.min(...heights), maxHeight: Math.max(...heights), maxTwoFrameMs: Math.max(...frames), averageTwoFrameMs: frames.reduce((sum, value) => sum + value) / frames.length };
}
function tailBounds(code: HTMLElement) {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  while ((text = walker.nextNode())) {
    const index = text.textContent!.indexOf('LONG_LINE_END');
    if (index < 0) continue;
    const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 'LONG_LINE_END'.length);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }
  throw new Error('Long-line tail is absent');
}
async function horizontal() {
  viewport().scrollTop = 0;
  await settle();
  const scrollbars = [...document.querySelectorAll<HTMLElement>('.review-split-scrollbar')];
  const initial = scrollbars.map((bar) => bar.scrollLeft);
  for (const scrollbar of scrollbars) scrollbar.scrollLeft = scrollbar.scrollWidth;
  if (!scrollbars.length) document.querySelector<HTMLElement>('.review-diff')!.scrollLeft = 100_000;
  await settle();
  const results = codes().filter((code) => code.textContent?.includes('LONG_LINE_END')).map((code) => {
    const clip = (code.closest('.review-diff-code') ?? document.querySelector('.review-diff'))!.getBoundingClientRect();
    const tail = tailBounds(code);
    return { tail, viewport: { left: clip.left, right: clip.right }, reachable: tail.left >= clip.left - 1 && tail.right <= clip.right + 1 };
  });
  return { initial, scrollLeft: scrollbars.map((bar) => bar.scrollLeft), results };
}
function colors() {
  return ['.diff-context', '.diff-remove', '.diff-add', '.review-diff code'].map((selector) => {
    const element = document.querySelector(selector)!;
    const style = getComputedStyle(element);
    return { selector, color: style.color, background: style.backgroundColor, lineHeight: style.lineHeight };
  });
}
function contrast() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const luminance = () => {
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    const linear = (value: number) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; };
    return .2126 * linear(red!) + .7152 * linear(green!) + .0722 * linear(blue!);
  };
  const entries = new Map<string, { kind: string; token: string; foreground: string; background: string; ratio: number }>();
  for (const code of codes()) {
    const row = code.closest('.review-diff-cell, .review-unified-row')!;
    const kind = row.classList.contains('diff-add') ? 'add' : row.classList.contains('diff-remove') ? 'remove' : 'context';
    for (const token of [code, ...code.querySelectorAll<HTMLElement>('span'), ...row.querySelectorAll<HTMLElement>('.diff-number, .diff-sign')]) {
      const foreground = getComputedStyle(token).color;
      const key = `${kind}:${token.className}:${foreground}`;
      if (entries.has(key)) continue;
      context.clearRect(0, 0, 1, 1);
      const ancestors: Element[] = [];
      for (let current: Element | null = token; current; current = current.parentElement) ancestors.unshift(current);
      for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
      const backgroundLuminance = luminance();
      const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',');
      context.fillStyle = foreground; context.fillRect(0, 0, 1, 1);
      const foregroundLuminance = luminance();
      const ratio = (Math.max(backgroundLuminance, foregroundLuminance) + .05) / (Math.min(backgroundLuminance, foregroundLuminance) + .05);
      entries.set(key, { kind, token: token.className || 'code', foreground, background, ratio });
    }
  }
  return [...entries.values()];
}
async function profileSweep() {
  const longTasks: { start: number; duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
  });
  observer.observe({ type: 'longtask' });
  const result = await sweep();
  await settle();
  observer.disconnect();
  return { ...result, longTasks };
}
async function idle(empty: boolean) {
  if (empty) { flushSync(() => root.render(<div>Empty browser frame baseline</div>)); await settle(); }
  const samples: number[] = [];
  for (let index = 0; index < 51; index++) {
    const start = performance.now(); await settle(2); samples.push(performance.now() - start);
  }
  return { averageTwoFrameMs: samples.reduce((sum, value) => sum + value) / samples.length, maxTwoFrameMs: Math.max(...samples) };
}
let stopFrameMonitor: (() => unknown) | undefined;
function startFrameMonitor() {
  const intervals: number[] = [], longTasks: number[] = [];
  let previous: number | undefined, request = 0;
  const tick = (timestamp: number) => {
    if (previous !== undefined) intervals.push(timestamp - previous);
    previous = timestamp; request = requestAnimationFrame(tick);
  };
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(entry.duration); });
  observer.observe({ type: 'longtask' });
  request = requestAnimationFrame(tick);
  stopFrameMonitor = () => {
    cancelAnimationFrame(request); observer.disconnect();
    const sorted = [...intervals].sort((a, b) => a - b);
    return { frameCount: intervals.length, averageFrameMs: intervals.reduce((sum, value) => sum + value) / intervals.length,
      p95FrameMs: sorted[Math.ceil(sorted.length * .95) - 1], maxFrameMs: Math.max(...intervals), longTasks, final: snapshot() };
  };
}
Object.assign(window, { reviewBenchmark: { mount, sweep, profileSweep, idle, startFrameMonitor, stopFrameMonitor: () => stopFrameMonitor?.(),
  horizontal, colors, contrast, snapshot, runApp: () => runReviewAppBenchmark(root) } });
