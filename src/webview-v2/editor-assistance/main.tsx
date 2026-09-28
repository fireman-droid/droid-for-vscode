import type { EditorAssistanceTransport } from './useEditorAssistance';
import { mountWebview } from '../shell/mount';
import { EditorAssistanceApp } from './EditorAssistanceApp';

const api = (globalThis as { __dvxApi?: Pick<EditorAssistanceTransport, 'postMessage'> }).__dvxApi;
if (api === undefined) throw new Error('Editor assistance failed to initialize.');
const transport: EditorAssistanceTransport = {
  postMessage: (message) => api.postMessage(message),
  subscribe: (listener) => {
    const receive = (event: MessageEvent<unknown>) => listener(event.data);
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
};
mountWebview(<EditorAssistanceApp transport={transport} />, (detail) => console.error(detail));
