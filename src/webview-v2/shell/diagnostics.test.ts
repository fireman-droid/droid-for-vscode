// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { watchWebviewHandshake } from './diagnostics';

afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('reports a missing valid host reply once and clears the watchdog after reply or page disposal', () => {
  vi.useFakeTimers();
  const port = { postMessage: vi.fn() };
  vi.stubGlobal('__dvxApi', port);
  const valid = (value: unknown) => value === 'valid-host-reply';
  watchWebviewHandshake(valid);
  window.dispatchEvent(new MessageEvent('message', { data: 'invalid' }));
  vi.advanceTimersByTime(30_000);
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'webview.diagnostic', kind: 'handshake-timeout', detail: 'No valid host reply received within 15s.',
  });
  watchWebviewHandshake(valid);
  window.dispatchEvent(new MessageEvent('message', { data: 'valid-host-reply' }));
  watchWebviewHandshake(valid);
  window.dispatchEvent(new Event('pagehide'));
  vi.advanceTimersByTime(30_000);
  expect(port.postMessage).toHaveBeenCalledOnce();
});
