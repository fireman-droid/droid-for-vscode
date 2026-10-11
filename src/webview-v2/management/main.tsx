import { mountWebview } from '../shell/mount';
import { ManagementApp } from './ManagementApp';
import type { ManagementTransport } from './useManagement';
import type { ManagementRequest } from '../../shared/protocol/managementPageProtocol';
import type { ModelsRequest } from '../../shared/protocol/modelManagerProtocol';
import type { ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';

const api = (globalThis as { __dvxApi?: { postMessage(message: ManagementRequest | ModelsRequest | ModelSourceRequest): void } }).__dvxApi;
if (!api) throw new Error('Management failed to initialize.');
const transport: ManagementTransport = {
  postMessage: message => api.postMessage(message), postModelSourceMessage: message => api.postMessage(message),
  postManagement: message => api.postMessage(message),
  subscribe: listener => {
    const receive = (event: MessageEvent<unknown>) => listener(event.data);
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
};
mountWebview(<ManagementApp transport={transport} />, detail => console.error(detail));
