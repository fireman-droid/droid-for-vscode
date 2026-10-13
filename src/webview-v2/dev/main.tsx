import { createStudioRuntime, parseStudioConfig } from './studioRuntime';
import { createBrowserRuntime } from './browserRuntime';
import { ChatApp } from '../chat/ChatApp';
import { mountWebview } from '../shell/mount';
import { ModelsPreview } from './ModelsPreview';
import { MissionControlApp } from '../mission/MissionControlApp';
import { SessionViewerApp } from '../viewer/SessionViewerApp';
import { createPanelPreview } from './panelPreview';
import { BtwPreview } from './BtwPreview';
import { ManagementApp } from '../management/ManagementApp';
import type { ManagementTransport } from '../management/useManagement';
import '../theme.css';

function mountLiveChat(): void {
  const management = new URLSearchParams(window.location.search).get('view') === 'management';
  let runtime: ReturnType<typeof createBrowserRuntime>;
  try {
    runtime = createBrowserRuntime(management ? 'management' : 'chat');
  } catch {
    mountWebview(<main className="space-y-2 p-4">
      <h1 className="text-sm font-medium">Browser connection unavailable</h1>
      <p className="text-xs text-muted-foreground">Run Droid: Start Browser Dev Client in Cursor, then open the newly copied URL.</p>
    </main>, (detail) => console.error(detail));
    return;
  }
  (globalThis as { __dvxApi?: typeof runtime }).__dvxApi = runtime;
  document.title = management ? 'Droid · Management' : 'Droid · Chat';
  if (management) {
    const transport: ManagementTransport = {
      postMessage: message => runtime.postMessage(message),
      postModelSourceMessage: message => runtime.postMessage(message),
      postManagement: message => runtime.postMessage(message),
      subscribe: listener => {
        const receive = (event: MessageEvent<unknown>) => listener(event.data);
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
      },
    };
    mountWebview(<ManagementApp transport={transport} />, detail => console.error(detail));
    return;
  }
  mountWebview(<ChatApp port={runtime} />, (detail) =>
    runtime.postMessage({ type: 'webview.diagnostic', kind: 'error', detail }));
}

if (window.location.pathname === '/live') {
  mountLiveChat();
} else {
  const config = parseStudioConfig(window.location.search);
  const runtime = createStudioRuntime(config);
  const root = document.getElementById('root')!;
  document.documentElement.dataset.dvxTheme = config.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.dvxThemePreference = config.theme;
  const view = new URLSearchParams(window.location.search).get('view');
  const page = view === 'models' ? <ModelsPreview />
    : view === 'btw' ? <BtwPreview port={runtime} />
    : view === 'mission' ? <MissionControlApp vscode={createPanelPreview(config)} />
      : view === 'viewer' ? <SessionViewerApp vscode={createPanelPreview(config)} />
        : <ChatApp port={runtime} />;
  mountWebview(page, (detail) => console.error(detail));
  root.style.maxWidth = `${config.width}px`;
  root.style.margin = '0 auto';
}
