import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SessionViewerApp } from './SessionViewerApp';

declare global {
  interface Window {
    __dvxApi?: {
      postMessage(message: unknown): void;
    };
    __dvxBooted?: boolean;
  }
}

const root = document.getElementById('root');
const vscode = window.__dvxApi;
if (root === null || vscode === undefined) {
  throw new Error('Session Viewer failed to initialize.');
}

createRoot(root).render(
  <StrictMode>
    <SessionViewerApp vscode={vscode} />
  </StrictMode>,
);
