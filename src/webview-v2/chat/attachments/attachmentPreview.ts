import type { AttachmentStage } from '../../../shared/bridgeMessages';
import { parseAttachmentPreviewResponse, type AttachmentPreviewContent } from '../../../shared/protocol/attachmentPreviewProtocol';
import type { getVsCodeApi } from '../../bridge/vscode';

export type AttachmentPreviewResult = AttachmentPreviewContent | { readonly status: 'error'; readonly message: string };

export function requestAttachmentPreview(
  vscode: ReturnType<typeof getVsCodeApi>, sessionId: string | null,
  attachmentId: string, stage: AttachmentStage | undefined,
  onResult: (result: AttachmentPreviewResult) => void,
): () => void {
  if (sessionId === null) { onResult({ status: 'unavailable' }); return () => {}; }
  const cleanup = () => { window.removeEventListener('message', receive); window.clearTimeout(timeout); };
  const receive = (event: MessageEvent<unknown>) => {
    const result = parseAttachmentPreviewResponse(event.data);
    if (!result || result.sessionId !== sessionId || result.attachmentId !== attachmentId || result.stage !== stage) return;
    cleanup();
    onResult(result);
  };
  const timeout = window.setTimeout(() => {
    cleanup();
    onResult({ status: 'error', message: 'File preview timed out. Close and reopen the preview to retry.' });
  }, 5_000);
  window.addEventListener('message', receive);
  try {
    vscode.postMessage({ type: 'attachment.preview', sessionId, attachmentId, ...(stage === undefined ? {} : { stage }) });
  } catch {
    cleanup();
    onResult({ status: 'error', message: 'Unable to request the file preview. Close and reopen the preview to retry.' });
  }
  return cleanup;
}
