import { createRoot } from 'react-dom/client';

import { App } from './assistant/App';
import { AppErrorBoundary } from './assistant/AppErrorBoundary';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('DroidVisX webview root element was not found.');
}

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
