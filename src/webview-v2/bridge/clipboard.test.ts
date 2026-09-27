// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('copies exactly the requested text through the host without selecting the document, and waits for its own acknowledgement', async () => {
  document.body.textContent = 'Keep this selection';
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(document.body);
  selection.removeAllRanges(); selection.addRange(range);
  const postMessage = vi.fn();
  vi.stubGlobal('__dvxApi', { postMessage });
  const settled = vi.fn();
  const pending = copyText('pnpm test').then(settled);
  expect(postMessage).toHaveBeenCalledWith({ type: 'clipboard.write', requestId: expect.any(String), text: 'pnpm test' });
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'clipboard.result', requestId: 'another-copy', ok: true } }));
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(selection.toString()).toBe('Keep this selection');
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'clipboard.result', requestId: postMessage.mock.calls[0][0].requestId, ok: true } }));
  await pending;
  expect(settled).toHaveBeenCalledOnce();
  expect(selection.toString()).toBe('Keep this selection');
});

it('reports host failure without trying a page selection fallback', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('__dvxApi', { postMessage });
  const pending = copyText('command');
  const rejected = expect(pending).rejects.toThrow('Could not copy text');
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'clipboard.result', requestId: postMessage.mock.calls[0][0].requestId, ok: false } }));
  await rejected;
});
