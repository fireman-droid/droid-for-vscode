import { createRoot } from 'react-dom/client';
import { ModelsApp } from './ModelsApp';
import type { ModelsTransport } from './useModels';
import './models.css';

const root = document.getElementById('root');
const api = window.__dvxApi;
if (root === null || api === undefined) throw new Error('Models failed to initialize.');
const transport: ModelsTransport = {
  postMessage: (message) => api.postMessage(message),
  subscribe: (listener) => {
    const receive = (event: MessageEvent<unknown>): void => listener(event.data);
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
};
createRoot(root).render(<ModelsApp transport={transport} />);
window.__dvxBooted = true;
