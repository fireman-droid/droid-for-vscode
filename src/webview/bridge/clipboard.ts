import { MAX_CLIPBOARD_TEXT_LENGTH, parseClipboardResult, type ClipboardWrite } from '../../shared/protocol/clipboardProtocol';

let sequence = 0;

export function copyText(text: string): Promise<void> {
  const api = (globalThis as { __dvxApi?: { postMessage(message: ClipboardWrite): void } }).__dvxApi;
  if (!api) return navigator.clipboard.writeText(text);
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) return Promise.reject(new Error('Text is too large to copy.'));
  return new Promise((resolve, reject) => {
    const requestId = `copy-${++sequence}`;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      if (error) reject(error); else resolve();
    };
    const receive = (event: MessageEvent) => {
      const result = parseClipboardResult(event.data);
      if (result?.requestId === requestId) finish(result.ok ? undefined : new Error('Could not copy text.'));
    };
    const timeout = setTimeout(() => finish(new Error('Clipboard request timed out.')), 5000);
    window.addEventListener('message', receive);
    try { api.postMessage({ type: 'clipboard.write', requestId, text }); }
    catch (error) { finish(error instanceof Error ? error : new Error('Could not copy text.')); }
  });
}
