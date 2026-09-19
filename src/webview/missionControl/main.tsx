import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { MissionCatalog } from './MissionCatalog';
import { useMissionCatalog } from './useMissionCatalog';

declare global {
  interface Window {
    __dvxApi?: {
      postMessage(message: unknown): void;
    };
    __dvxBooted?: boolean;
  }
}

const rootElement = document.getElementById('root');
const vscode = window.__dvxApi;
if (rootElement === null || vscode === undefined) {
  throw new Error('Mission Control failed to initialize.');
}
const root = createRoot(rootElement);
const missionVscode = vscode;

function MissionPage() {
  return createElement(MissionCatalog, useMissionCatalog(missionVscode));
}
root.render(createElement(MissionPage));
