import { createRoot } from 'react-dom/client';

import { App } from './assistant/App';
import { AppErrorBoundary } from './assistant/shell/AppErrorBoundary';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('DroidVisX webview root element was not found.');
}

// On a pathologically slow load the HTML boot watchdog may already have
// painted its plain-text fallback into #root; React 18 createRoot does
// not clear pre-existing children, so remove it before mounting. Mark
// the bundle as booted immediately so a mount racing the 10s watchdog
// does not report a false boot-timeout (the boot-ok beacon itself still
// comes from App once the bridge is up).
(globalThis as { __dvxBooted?: boolean }).__dvxBooted = true;
rootElement.replaceChildren();
rootElement.removeAttribute('style');

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
