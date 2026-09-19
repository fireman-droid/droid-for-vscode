import { createStudioRuntime, parseStudioConfig } from '../../webview/dev/studioRuntime';
import { createBrowserRuntime } from '../../webview/dev/browserRuntime';
import { ChatApp } from '../chat/ChatApp';
import { mountWebview } from '../shell/mount';
import { ModelsPreview } from './ModelsPreview';
import { MissionControlApp } from '../mission/MissionControlApp';
import { SessionViewerApp } from '../viewer/SessionViewerApp';
import { createPanelPreview } from './panelPreview';
import { BtwPreview } from './BtwPreview';
import '../theme.css';

function mountLiveChat(): void {
  let runtime: ReturnType<typeof createBrowserRuntime>;
  try {
    runtime = createBrowserRuntime();
  } catch {
    mountWebview(<main className="space-y-2 p-4">
      <h1 className="text-sm font-medium">Browser connection unavailable</h1>
      <p className="text-xs text-muted-foreground">Run DroidVisX: Start Browser Dev Client in Cursor, then open the newly copied URL.</p>
    </main>, (detail) => console.error(detail));
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
