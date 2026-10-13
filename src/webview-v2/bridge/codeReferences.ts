import { parseCodeReferenceResult, type CodeReferenceRequest } from '../../shared/protocol/codeReferenceProtocol';
import type { CodeReference } from '@droidvisx/chat-ui/chat/codeReferences';

const api = () => (globalThis as { __dvxApi?: { postMessage(message: CodeReferenceRequest): void } }).__dvxApi;

export function resolveCodeReference(markers: readonly string[], text: string): Promise<CodeReference | null> {
  const host = api();
  if (!host) return Promise.resolve(null);
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = (reference: CodeReference | null) => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(reference); };
    const receive = (event: MessageEvent) => {
      const result = parseCodeReferenceResult(event.data);
      if (result?.requestId === requestId) finish(result.reference);
    };
    const timer = setTimeout(() => finish(null), 1500);
    window.addEventListener('message', receive);
    try { host.postMessage({ type: 'codeReference.resolve', requestId, markers, text }); } catch { finish(null); }
  });
}

export function openCodeReference(reference: CodeReference): void { api()?.postMessage({ type: 'codeReference.open', reference }); }
