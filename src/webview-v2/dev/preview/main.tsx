import { useEffect, useState } from 'react';
import { ChatApp } from '../../chat/ChatApp';
import { ManagementApp } from '../../management/ManagementApp';
import { ModelsApp } from '../../models/ModelsApp';
import { MissionControlApp } from '../../mission/MissionControlApp';
import { SessionViewerApp } from '../../viewer/SessionViewerApp';
import { ReviewApp } from '../../review/ReviewApp';
import { BtwPreview } from '../BtwPreview';
import { mountWebview } from '../../shell/mount';
import { Button } from '../../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/selection';
import { parseStudioConfig } from '../studioRuntime';
import { getStudioScenario } from '../scenarios';
import { createPreviewRuntime, isPreviewView, type PreviewView, PREVIEW_VIEWS } from './runtime';
import '../../theme.css';
import './preview.css';

const config = parseStudioConfig(window.location.search);
const initialView = new URLSearchParams(window.location.search).get('view');
const runtime = createPreviewRuntime(config, {
  notice: message => window.dispatchEvent(new CustomEvent('preview.notice', { detail: message })),
  navigate: view => window.dispatchEvent(new CustomEvent('preview.navigate', { detail: view })),
});
// Supply the production shell's clipboard/locale port before it mounts.
Object.assign(globalThis, { __dvxApi: runtime });
document.documentElement.dataset.dvxTheme = config.theme === 'light' ? 'light' : 'dark';
document.documentElement.dataset.dvxThemePreference = config.theme;

const labels: Record<PreviewView, string> = {
  chat: 'Chat', management: 'Settings', models: 'Models', mission: 'Mission', viewer: 'Viewer', review: 'Review', btw: 'BTW',
};

function PreviewApp() {
  const [view, setView] = useState<PreviewView>(isPreviewView(initialView) ? initialView : 'chat');
  const [notice, setNotice] = useState('Fixed example data. No Droid backend, real workspace or account is connected.');
  const navigate = (next: PreviewView) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };
  useEffect(() => {
    const onNotice = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    const onNavigate = (event: Event) => navigate((event as CustomEvent<PreviewView>).detail);
    window.addEventListener('preview.notice', onNotice);
    window.addEventListener('preview.navigate', onNavigate);
    return () => {
      window.removeEventListener('preview.notice', onNotice);
      window.removeEventListener('preview.navigate', onNavigate);
    };
  }, []);
  const reload = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.location.assign(url);
  };
  const page = view === 'management' ? <ManagementApp transport={runtime} />
    : view === 'models' ? <ModelsApp transport={runtime} />
    : view === 'mission' ? <MissionControlApp vscode={runtime} />
    : view === 'viewer' ? <SessionViewerApp vscode={runtime} />
    : view === 'review' ? <ReviewApp port={runtime} />
    : view === 'btw' ? <BtwPreview port={runtime} readOnly />
    : <ChatApp port={runtime} />;
  return <div className="preview-shell">
    <header data-ui-notice="" className="preview-toolbar">
      <strong>Offline UI preview</strong>
      <Select value={view} onValueChange={value => { if (isPreviewView(value)) navigate(value); }}>
        <SelectTrigger aria-label="Preview page"><SelectValue /></SelectTrigger>
        <SelectContent>{PREVIEW_VIEWS.map(value => <SelectItem key={value} value={value}>{labels[value]}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={config.theme} onValueChange={value => reload('theme', value)}>
        <SelectTrigger aria-label="Preview theme"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="auto">Auto</SelectItem></SelectContent>
      </Select>
      <Select value={config.scenario} onValueChange={value => reload('scenario', value)}>
        <SelectTrigger aria-label="Chat example"><SelectValue /></SelectTrigger>
        <SelectContent>{(['full-workflow', 'conversation', 'empty', 'ask-user', 'permission'] as const).map(value =>
          <SelectItem key={value} value={value}>{getStudioScenario(value).label}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>Reset examples</Button>
    </header>
    <p data-ui-notice="" role="status" className="preview-notice">{notice}</p>
    <section className="preview-product" aria-label={`${labels[view]} production UI`}
      style={{ maxWidth: view === 'chat' ? `${config.width}px` : undefined }} key={view}>{page}</section>
  </div>;
}

mountWebview(<PreviewApp />, detail => console.error(detail));
window.addEventListener('pagehide', () => runtime.dispose(), { once: true });
