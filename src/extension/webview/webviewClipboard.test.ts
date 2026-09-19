import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { handleWebviewClipboard } from './webviewClipboard';

vi.mock('vscode', () => ({ env: { clipboard: { writeText: vi.fn() } } }));
beforeEach(() => vi.clearAllMocks());

it('acknowledges native writes and rejects unbounded or malformed requests without copying', async () => {
  const write = vi.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);
  const postMessage = vi.fn().mockResolvedValue(true);
  const request = { type: 'clipboard.write', requestId: 'copy-1', text: 'pnpm test' };
  expect(handleWebviewClipboard({ ...request, text: 'x'.repeat(2_000_001) }, { postMessage })).toBe(false);
  expect(handleWebviewClipboard({ ...request, extra: true }, { postMessage })).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(handleWebviewClipboard(request, { postMessage })).toBe(true);
  await Promise.resolve();
  expect(write).toHaveBeenCalledExactlyOnceWith('pnpm test');
  expect(postMessage).toHaveBeenCalledWith({ type: 'clipboard.result', requestId: 'copy-1', ok: true });
  write.mockRejectedValueOnce(new Error('Unavailable'));
  handleWebviewClipboard({ ...request, requestId: 'copy-2' }, { postMessage });
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledWith({ type: 'clipboard.result', requestId: 'copy-2', ok: false });
});
