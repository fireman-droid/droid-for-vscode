import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ReviewApp } from '../review/ReviewApp';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';

type Request = { type: string; requestId: string; context?: number | 'all'; toolUseId?: string; path?: string };
const path = 'src/mission-worker.ts';
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function waitFor(predicate: () => boolean, label: string) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 6_000) throw new Error(`ReviewApp benchmark: ${label}`);
    await frame();
  }
  await frame();
}
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((element) => element.getAttribute('aria-label') === label || element.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
let clickSequence = 0;
let currentStep = '';
async function click(element: HTMLElement) {
  const driver = (window as unknown as { reviewBenchmarkClick?: (selector: string) => Promise<void> }).reviewBenchmarkClick;
  if (!driver) throw new Error('The ReviewApp benchmark requires its isolated browser click driver');
  const id = String(++clickSequence);
  element.dataset.reviewBenchmarkTarget = id;
  await driver(`[data-review-benchmark-target="${id}"]`);
  delete element.dataset.reviewBenchmarkTarget;
}
async function menuItem(trigger: string, label: string) {
  currentStep = `open ${trigger}: ${label}`;
  await waitFor(() => !document.querySelector('[role="menu"]') && getComputedStyle(document.body).pointerEvents !== 'none', 'previous menu exit animation');
  await click(button(trigger));
  const find = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.startsWith(label) && item.closest('[role="menu"]')?.getAttribute('data-state') === 'open' &&
      item.getBoundingClientRect().height > 0);
  await waitFor(() => button(trigger).getAttribute('aria-expanded') === 'true' && !!find(), `open menu ${trigger}`);
  currentStep = `select ${label}`;
  await click(find()!);
  await waitFor(() => button(trigger).getAttribute('aria-expanded') === 'false' && !document.querySelector('[role="menu"]') &&
    getComputedStyle(document.body).pointerEvents !== 'none', `close menu ${trigger}`);
}
function fullPatch(toolUseId: string, marker: string) {
  const lines = ['@@ -1,400 +1,400 @@'];
  for (let line = 1; line <= 400; line++) {
    const text = line === 1 ? `// FULL_FILE_START ${marker}` : line === 400 ? '// FULL_FILE_END'
      : `const context_${line} = inspectWorker(${line});`;
    if ([40, 220, 360].includes(line)) lines.push(`-${text}`, `+${text.replace('inspectWorker', toolUseId === 'first' ? 'runWorker' : 'finishWorker')}`);
    else lines.push(` ${text}`);
  }
  return lines.join('\n');
}

/** Runs against production ReviewApp in the isolated browser fixture, with a synthetic Host. */
export async function runReviewAppBenchmark(root: Root) {
  const requests: Request[] = [];
  let sequence = 0;
  let holdReads = false;
  let scope: ReviewScopeState = {
    sessionId: 'benchmark-session', reviewScopeId: 'benchmark-scope', scopeKind: 'operations', turnId: 'benchmark-turn',
    baseline: 'benchmark-baseline', baselineLabel: 'Recorded edits from this turn', lifecycle: 'writing', currentIndex: 0,
    reviewedCount: 0, reviewableCount: 1,
    files: [{ path, additions: null, deletions: null, status: 'unreviewed', version: 'v1', restorable: false }],
  };
  const entries: ReviewRecordedEntry[] = [
    { toolUseId: 'first', toolName: 'Edit', source: 'tool-result', outcome: 'applied', patch: '@@ -40 +40 @@\n-before\n+first excerpt' },
    { toolUseId: 'second', toolName: 'Edit', source: 'tool-result', outcome: 'applied', patch: '@@ -220 +220 @@\n-before\n+second excerpt' },
  ];
  const send = (message: unknown) => window.dispatchEvent(new MessageEvent('message', { data: message }));
  const state = (version: string, lifecycle = scope.lifecycle) => {
    scope = { ...scope, lifecycle, files: [{ ...scope.files[0]!, version }] };
    send({ type: 'review.state', sequence: ++sequence, state: scope });
  };
  const reply = (request: Request, marker = 'INITIAL_SNAPSHOT', version = scope.files[0]!.version) => {
    const selected = request.toolUseId ?? 'second';
    send({ type: 'reviewPanel.file', requestId: request.requestId, reviewScopeId: scope.reviewScopeId,
      path, version, patch: '', truncated: false, error: null,
      recordedOperations: entries.map((entry) => entry.toolUseId === selected && request.context === 'all'
        ? { ...entry, fullPatch: fullPatch(selected, marker) } : entry) });
  };
  const reads = () => requests.filter((request) => request.type === 'reviewPanel.readFile');
  const latest = () => reads().at(-1)!;
  const text = () => document.body.textContent ?? '';
  const viewport = () => document.querySelector<HTMLElement>('.review-code-scroll')!;
  const port = { postMessage(message: unknown) {
    const request = message as Request;
    requests.push(request);
    if (request.type === 'reviewPanel.ready') setTimeout(() => {
      send({ type: 'reviewPanel.context', sessionId: scope.sessionId, latestTurnId: scope.turnId,
        valid: true, operation: null, operationPath: path, toolUseId: 'first' });
      send({ type: 'review.state', sequence: ++sequence, state: scope });
    }, 0);
    else if (request.type === 'reviewPanel.readFile' && !holdReads) setTimeout(() => reply(request), 15);
  } };
  Object.assign(window, { reviewAppBenchmarkDiagnostic: () => ({ currentStep, requests, lifecycle: scope.lifecycle,
    version: scope.files[0]!.version, holdingReads: holdReads }) });
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.themePreference = 'dark';
  flushSync(() => root.render(<ReviewApp key="whole-app" port={port} />));
  await waitFor(() => text().includes('FULL_FILE_START INITIAL_SNAPSHOT'), 'initial full file');
  if (latest().toolUseId !== 'first' || latest().path !== path || !text().includes('Edit 1 of 2'))
    throw new Error('Card target did not select the requested edit');
  viewport().scrollTop = viewport().scrollHeight;
  await waitFor(() => text().includes('FULL_FILE_END'), 'full file end is reachable');
  viewport().scrollTop = 0;
  await waitFor(() => text().includes('FULL_FILE_START'), 'return to full file start');

  await menuItem('More file actions', 'Saved change excerpts');
  await waitFor(() => text().includes('first excerpt') && !text().includes('FULL_FILE_START'), 'excerpt mode');
  if (latest().context !== 3 || latest().toolUseId !== 'first') throw new Error('Excerpt selection lost its edit');
  await menuItem('More file actions', 'Request full file context');
  await waitFor(() => text().includes('FULL_FILE_START'), 'restore full context');
  await menuItem('More file actions', 'Open Native Diff');
  if (requests.at(-1)?.type !== 'reviewPanel.openNative' || requests.at(-1)?.toolUseId !== 'first')
    throw new Error('Native Diff did not receive the selected edit');
  await click(button('Next recorded edit'));
  await waitFor(() => latest().toolUseId === 'second' && text().includes('finishWorker'), 'next edit');
  await click(button('Previous recorded edit'));
  await waitFor(() => latest().toolUseId === 'first' && text().includes('runWorker'), 'previous edit');

  holdReads = true;
  let count = reads().length;
  state('v2');
  await waitFor(() => reads().length > count, 'start live read');
  const liveRequest = latest();
  count = reads().length;
  state('v3');
  reply(liveRequest, 'LIVE_SNAPSHOT', 'v2');
  await waitFor(() => text().includes('LIVE_SNAPSHOT'), 'show live snapshot before writing stops');
  await waitFor(() => reads().length > count, 'queue newer live read');
  const staleRequest = latest();
  count = reads().length;
  state('v4', 'settled');
  reply(staleRequest, 'OBSOLETE_LIVE', 'v3');
  await waitFor(() => reads().length > count, 'read settled result');
  if (text().includes('OBSOLETE_LIVE')) throw new Error('Obsolete live response crossed the settlement boundary');
  reply(latest(), 'SETTLED_SNAPSHOT', 'v4');
  await waitFor(() => text().includes('SETTLED_SNAPSHOT') && text().includes('Recorded operations · inspect'), 'settled result');
  holdReads = false;

  await click(button('Split view'));
  await waitFor(() => !!document.querySelector('.review-split-labels'), 'split layout');
  const positions: { target: number; top: number; headerBottom: number; visible: boolean }[] = [];
  const jump = async (direction: 'Next change' | 'Previous change', target: number) => {
    await click(button(direction));
    const marker = () => [...document.querySelectorAll<HTMLElement>('.review-split-row')]
      .find((row) => row.textContent?.includes(`context_${[40, 220, 360][target]} = runWorker`));
    const header = () => document.querySelector('.review-split-labels')!.getBoundingClientRect();
    await waitFor(() => !!marker() && Math.abs(marker()!.getBoundingClientRect().top - header().bottom) < 2, `${direction} below sticky header`);
    const top = marker()!.getBoundingClientRect().top;
    const headerBottom = header().bottom;
    const visible = top >= headerBottom - 1 && top < viewport().getBoundingClientRect().bottom;
    positions.push({ target, top, headerBottom, visible });
    if (!visible) throw new Error('Change navigation hid its target behind the split heading');
  };
  await jump('Next change', 0);
  await jump('Next change', 1);
  await jump('Previous change', 0);
  return { cardTarget: true, fullFileReachable: true, contextSwitch: true, selectedNative: true,
    editSwitch: true, liveBeforeSettlement: true, staleLiveRejected: true, settled: true,
    requestCount: reads().length, navigation: positions };
}
