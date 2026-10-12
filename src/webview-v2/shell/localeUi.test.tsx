// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { ComposerView } from '@droidvisx/chat-ui/chat/ComposerView';
import { Markdown } from '@droidvisx/chat-ui/content/Markdown';
import { TooltipProvider } from '@droidvisx/chat-ui/ui/overlays';
import { WebviewLocaleProvider } from './locale';
import { ManagementApp } from '../management/ManagementApp';
import { ReviewApp } from '../review/ReviewApp';
import { MissionSetup } from '../mission/MissionSetup';
import { SessionViewerApp } from '../viewer/SessionViewerApp';
import type { ManagementRequest, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import type { MissionSetupCapabilities } from '../../shared/protocol/missionProtocol';
import { SESSION_VIEWER_PROTOCOL_VERSION } from '../../shared/protocol/sessionViewerProtocol';

const port = { postMessage: vi.fn() };
const settings: ManagementSettings = {
  theme: 'light', resolvedTheme: 'light', version: '0.8.10', cwd: null, connection: 'connected', ide: 'connected',
  completion: { enabled: false, autoTrigger: true, relatedFiles: false, adaptiveDebounce: false,
    debounceMs: 300, protocol: 'fim', endpoint: 'https://example.invalid/completions', model: 'local-fixture' }, completionHasKey: false,
  sessionManagementAvailable: false, reviewQuestion: { modelId: null, models: [] },
};
const capabilities: MissionSetupCapabilities = {
  currentChat: { modelId: 'model', reasoningEffort: 'high' }, catalogStatus: 'ready',
  catalog: [{ id: 'model', displayName: 'Model 原名', supportedReasoningEfforts: ['low', 'high'] }],
  preferences: { worker: { mode: 'same-as-orchestrator', modelId: 'model', reasoningEffort: 'high' },
    validator: { mode: 'same-as-orchestrator', modelId: 'model', reasoningEffort: 'high' },
    scrutinyEnabled: true, userTestingEnabled: true },
};
const locale = (resolved: 'en' | 'zh-CN' | 'zh-TW') => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'ui.locale', preference: resolved, resolved } }));
});
beforeEach(() => {
  document.documentElement.lang = 'en'; document.documentElement.dataset.dvxLanguage = 'auto';
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('__dvxApi', port);
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function ChatDraft() {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  return <><ComposerView value={draft} onChange={setDraft} onSend={vi.fn()} placeholder={t('Add a follow up')} />
    <Markdown text={'User / model content: Settings 常规\n\n`const label = "Send";`'} /></>;
}

it('changes live chat labels without remounting the editor or translating messages and code', () => {
  render(<WebviewLocaleProvider><ChatDraft /></WebviewLocaleProvider>);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '我的草稿 🙂 Send' } });
  input.focus(); input.setSelectionRange(2, 4);
  for (const next of ['zh-CN', 'zh-TW', 'en'] as const) {
    locale(next);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('我的草稿 🙂 Send');
    expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(4);
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: { en: 'Send', 'zh-CN': '发送', 'zh-TW': '發送' }[next] })).toBeDefined();
    expect(screen.getByText('User / model content: Settings 常规')).toBeDefined();
    expect(screen.getByText('const label = "Send";')).toBeDefined();
    expect(document.documentElement.lang).toBe(next);
  }
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ui.locale.read' });
});

it('switches language from General settings and retains the Mission draft and model names', async () => {
  const listeners = new Set<(message: unknown) => void>();
  const transport = { postMessage: vi.fn(), subscribe: (listener: (message: unknown) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, postManagement: vi.fn((request: ManagementRequest) => {
    queueMicrotask(() => {
      if (request.action.kind === 'language.set') locale(request.action.language === 'auto' ? 'en' : request.action.language);
      listeners.forEach(listener => listener({ type: 'management.result', version: 1, requestId: request.requestId, ok: true, settings }));
    });
  }) };
  const user = userEvent.setup();
  render(<WebviewLocaleProvider><TooltipProvider><div data-testid="management"><ManagementApp transport={transport} /></div>
    <div data-testid="mission"><MissionSetup capabilities={capabilities} initialTask="原始 task" onStart={vi.fn()} onDismiss={vi.fn()} /></div>
  </TooltipProvider></WebviewLocaleProvider>);
  const management = within(screen.getByTestId('management'));
  const mission = within(screen.getByTestId('mission'));
  const draft = mission.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: '保留任务草稿' } });
  for (const [choice, heading] of [['简体中文', '常规'], ['繁體中文', '常規'], ['English', 'General']] as const) {
    const language = await management.findByRole('combobox', { name: /Language|语言|語言/ });
    await user.click(language); await user.click(screen.getByRole('option', { name: choice, exact: true }));
    expect(await management.findByRole('heading', { name: heading })).toBeDefined();
    expect(mission.getByRole('textbox')).toBe(draft); expect(draft.value).toBe('保留任务草稿');
    expect(mission.getByText('Model 原名')).toBeDefined();
  }
  expect(transport.postManagement.mock.calls.filter(([request]) => request.action.kind === 'language.set')).toHaveLength(3);
  await user.click(management.getByRole('button', { name: 'Models', exact: true }));
  for (const [language, name] of [['zh-CN', '模型'], ['zh-TW', '模型'], ['en', 'Models']] as const) {
    locale(language);
    expect(management.getByRole('heading', { name, exact: true })).toBeDefined();
  }
});

it('updates Review and read-only Viewer controls in all three languages', () => {
  render(<WebviewLocaleProvider><div data-testid="review"><ReviewApp port={port} /></div>
    <div data-testid="viewer"><SessionViewerApp vscode={port} /></div></WebviewLocaleProvider>);
  act(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'sessionViewer.snapshot', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION, status: 'ready',
    target: { kind: 'daemon-session', mode: 'standard', sessionId: 'local', title: 'Keep title 原文' },
    items: [], truncated: false, running: true, lifecycle: 'working', stopping: false, stopError: false,
  } })));
  for (const [language, stop, options] of [['zh-CN', '停止', '审阅选项'], ['zh-TW', '停止', '審閱選項'], ['en', 'Stop', 'Review options']] as const) {
    locale(language);
    expect(within(screen.getByTestId('viewer')).getByRole('button', { name: stop, exact: true })).toBeDefined();
    expect(within(screen.getByTestId('review')).getByRole('button', { name: options })).toBeDefined();
  }
});
