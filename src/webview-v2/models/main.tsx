import type { ModelsTransport } from './useModels';
import { mountWebview } from '../shell/mount';
import { ModelsApp } from './ModelsApp';

const api = (globalThis as { __dvxApi?: Pick<ModelsTransport, 'postMessage'> }).__dvxApi;
if (api === undefined) throw new Error('Models failed to initialize.');
const transport: ModelsTransport = {
  postMessage: (message) => api.postMessage(message),
  subscribe: (listener) => {
    const receive = (event: MessageEvent<unknown>) => listener(event.data);
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
};
mountWebview(<ModelsApp transport={transport} />, (detail) => console.error(detail));
