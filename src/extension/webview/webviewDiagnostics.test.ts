import { afterEach, expect, it, vi } from 'vitest';
import { recordWebviewDiagnostic, WebviewStartupDiagnostics, WEBVIEW_HANDSHAKE_TIMEOUT_MS } from './webviewDiagnostics';

afterEach(() => vi.useRealTimers());
it('routes only exact bounded diagnostic messages under the host-owned surface', () => {
  const diagnostics = { record: vi.fn() };
  const value = { type: 'webview.diagnostic', kind: 'error', detail: 'Caught render failure' };
  expect(recordWebviewDiagnostic(value, 'management', diagnostics)).toBe(true);
  expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
    level: 'warn', name: 'management.error', detail: value.detail,
  });
  for (const invalid of [{ ...value, surface: 'models' }, { ...value, kind: 'private-name' }, { ...value, detail: 'x'.repeat(2049) }])
    expect(recordWebviewDiagnostic(invalid, 'management', diagnostics)).toBe(false);
  expect(diagnostics.record).toHaveBeenCalledOnce();
});
it('times out a missing ready handshake once, but never a ready or disposed view', () => {
  vi.useFakeTimers();
  const diagnostics = { record: vi.fn() };
  const stuck = new WebviewStartupDiagnostics('models', diagnostics);
  const ready = new WebviewStartupDiagnostics('review', diagnostics);
  const disposed = new WebviewStartupDiagnostics('sessionViewer', diagnostics);
  ready.ready(); disposed.dispose();
  vi.advanceTimersByTime(WEBVIEW_HANDSHAKE_TIMEOUT_MS * 2);
  expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
    level: 'warn', name: 'models.handshake-timeout', detail: 'No ready request received within 15s.',
  });
  stuck.dispose(); ready.dispose();
});
