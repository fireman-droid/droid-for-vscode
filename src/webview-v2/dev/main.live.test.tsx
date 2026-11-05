// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MANAGEMENT_VERSION } from '../../shared/protocol/managementPageProtocol';
import type { ManagementTransport } from '../management/useManagement';

const harness = vi.hoisted(() => ({
  postMessage: vi.fn(), navigate: vi.fn(),
  mount: vi.fn<(node: ReactNode) => void>(),
  runtime: vi.fn(),
}));
vi.mock('./browserRuntime', () => ({ createBrowserRuntime: harness.runtime }));
vi.mock('../shell/mount', () => ({ mountWebview: harness.mount }));
vi.mock('../chat/ChatApp', () => ({ ChatApp: () => null }));
vi.mock('../management/ManagementApp', () => ({ ManagementApp: () => null }));
vi.mock('./studioRuntime', () => ({ createStudioRuntime: vi.fn(), parseStudioConfig: vi.fn() }));
vi.mock('./ModelsPreview', () => ({ ModelsPreview: () => null }));
vi.mock('../mission/MissionControlApp', () => ({ MissionControlApp: () => null }));
vi.mock('../viewer/SessionViewerApp', () => ({ SessionViewerApp: () => null }));
vi.mock('./panelPreview', () => ({ createPanelPreview: vi.fn() }));
vi.mock('./BtwPreview', () => ({ BtwPreview: () => null }));
vi.mock('../review/ReviewApp', () => ({ ReviewApp: () => null }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function boot(search = '') {
  vi.resetModules();
  harness.runtime.mockReturnValue({ postMessage: harness.postMessage });
  vi.stubGlobal('window', {
    location: { pathname: '/live', search, assign: harness.navigate },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
  });
  await import('./main');
  return harness.mount.mock.calls[0]![0] as { props: {
    port: { postMessage(message: unknown): void };
    transport: ManagementTransport;
  } };
}

it('keeps settings and model navigation in the browser while forwarding chat messages', async () => {
  const app = await boot();
  app.props.port.postMessage({ type: 'management.open', page: 'general' });
  expect(harness.navigate).toHaveBeenLastCalledWith('/live?view=management&page=general');
  app.props.port.postMessage({ type: 'management.open', page: 'automations' });
  expect(harness.navigate).toHaveBeenLastCalledWith('/live?view=management&page=automations');
  app.props.port.postMessage({ type: 'models.open' });
  expect(harness.navigate).toHaveBeenLastCalledWith('/live?view=management&page=models');
  expect(harness.postMessage).not.toHaveBeenCalled();
  app.props.port.postMessage({ type: 'webview.ready' });
  expect(harness.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'webview.ready' });
});

it.each([
  ['models', 'models'], ['automations', 'automations'], ['invalid', 'general'], ['', 'general'],
])('opens the management channel on the requested page %s', async (query, expected) => {
  const app = await boot(`?view=management&page=${query}`);
  expect(harness.runtime).toHaveBeenCalledWith('management');
  const listener = vi.fn();
  const unsubscribe = app.props.transport.subscribe(listener);
  try {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'management.navigate', version: MANAGEMENT_VERSION, page: 'missions',
    } }));
    expect(listener).toHaveBeenLastCalledWith({
      type: 'management.navigate', version: MANAGEMENT_VERSION, page: expected,
    });
    const request = { type: 'management.request', version: MANAGEMENT_VERSION,
      requestId: 'test', action: { kind: 'settings.read' } } as const;
    app.props.transport.postManagement(request);
    expect(harness.postMessage).toHaveBeenCalledWith(request);
  } finally { unsubscribe(); }
});
