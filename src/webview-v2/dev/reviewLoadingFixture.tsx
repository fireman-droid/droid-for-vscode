import { useEffect, useState } from 'react';
import { ReviewApp } from '../review/ReviewApp';
import { mountWebview } from '../shell/mount';
import { Button } from '../ui/button';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import '../theme.css';

// Isolated acceptance fixture: no extension connection, model, or filesystem actions.
let scope: ReviewScopeState = {
  sessionId: 'loading-fixture', reviewScopeId: 'loading-scope', scopeKind: 'turn', turnId: 'loading-turn',
  baseline: 'before:after', baselineLabel: 'Before turn → after turn', lifecycle: 'settled', currentIndex: 0,
  reviewedCount: 0, reviewableCount: 200,
  files: Array.from({ length: 200 }, (_, index) => ({ path: `src/file-${String(index).padStart(3, '0')}.ts`,
    version: `v1-${index}`, status: 'unreviewed', additions: 2, deletions: 2, restorable: false })),
};
const target = { type: 'reviewPanel.context', sessionId: scope.sessionId, latestTurnId: scope.turnId,
  valid: true, operation: null, operationPath: null };
let sequence = 0;
let requests = 0;
let active = 0;
let peak = 0;
let opened = performance.now();
const send = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
const publish = () => send({ type: 'review.state', sequence: ++sequence, state: scope });
const open = () => { opened = performance.now(); measure(opened); send({ ...target, resetReview: true }); publish(); };
let report = (_value: string) => {};
let measure = (_value: number) => {};
const port = { postMessage(value: unknown) {
  const request = value as { type: string; requestId?: string; path?: string; context?: number | 'all'; version?: string };
  if (request.type === 'reviewPanel.ready') setTimeout(open, 0);
  if (request.type === 'review.selectFile' && request.path) {
    scope = { ...scope, currentIndex: scope.files.findIndex(file => file.path === request.path) }; publish();
  }
  if (request.type === 'review.refresh') publish();
  if (request.type !== 'reviewPanel.readFile') return;
  const file = scope.files.find(file => file.path === request.path)!;
  requests++; active++; peak = Math.max(peak, active);
  const count = request.context === 'all' ? file.path.endsWith('199.ts') ? 6000 : 1200 : 12;
  const before = Array.from({ length: count }, (_, index) => `const value_${index} = ${index};`);
  const after = [...before]; after[2] = `const value_2 = 42; // ${file.version}`;
  after[count - 3] = 'const finalValue = 99;';
  const patch = [`@@ -1,${count} +1,${count} @@`, ...before.flatMap((line, index) => line === after[index]
    ? [` ${line}`] : [`-${line}`, `+${after[index]}`])].join('\n');
  setTimeout(() => {
    active--;
    send({ requestId: request.requestId, path: request.path, type: 'reviewPanel.file', reviewScopeId: scope.reviewScopeId,
      version: file.version, patch, truncated: false, error: null, syntaxSource: { before: before.join('\n'), after: after.join('\n') } });
    report(`200 files · reads ${requests} · active ${active} · peak ${peak}`);
  }, 80);
} };
function Fixture() {
  const [metrics, setMetrics] = useState('200 files');
  const [paint, setPaint] = useState('');
  const [started, setStarted] = useState(0);
  report = setMetrics;
  measure = setStarted;
  useEffect(() => {
    if (!started) return;
    let frame = 0;
    const probe = () => {
      const path = scope.files[scope.currentIndex ?? 0]!.path;
      const section = [...document.querySelectorAll<HTMLElement>('[data-review-path]')].find(element => element.dataset.reviewPath === path);
      if (section?.querySelector('[data-diff-changes]')) {
        setPaint(`visible diff ${Math.round(performance.now() - started)} ms`); return;
      }
      if (performance.now() - started < 10_000) frame = requestAnimationFrame(probe);
    };
    frame = requestAnimationFrame(probe);
    return () => cancelAnimationFrame(frame);
  }, [started]);
  const reopen = () => { setPaint(''); open(); };
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', flexShrink: 0 }}>
      <Button size="sm" onClick={reopen}>Reopen fixture</Button>
      <Button size="sm" onClick={() => {
        scope = { ...scope, files: scope.files.map(file => ({ ...file, version: `${file.version}-new` })) }; publish();
      }}>Change revision</Button>
      <Button size="sm" onClick={() => {
        const theme = document.documentElement.dataset.dvxTheme === 'light' ? 'dark' : 'light';
        send({ type: 'ui.theme', preference: theme, resolved: theme });
      }}>Toggle theme</Button>
      <output aria-label="Loading metrics">{metrics} · {paint}</output>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}><ReviewApp port={port} /></div>
  </div>;
}
mountWebview(<Fixture />, detail => { document.body.dataset.fixtureError = detail; console.error(detail); });
