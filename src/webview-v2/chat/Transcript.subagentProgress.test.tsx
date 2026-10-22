// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
import { useComposerFlow } from './composer/useComposerFlow';
import { Composer } from './Composer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const task: ToolTranscriptItem = {
  kind: 'tool', id: 'delegation', turnId: 'turn-1', toolUseId: 'task-1', toolName: 'Task',
  action: 'Delegate task', status: 'running', progressCount: 0, latestUpdateKind: null,
  subagent: { type: 'scout', description: 'Inspect the active module', status: 'running' },
};
const state: AssistantWebviewState = {
  ...initialAssistantWebviewState,
  sessionId: 'session-1', conversationId: 'conversation-1', connection: { status: 'connected' },
  turn: { turnId: 'turn-1', status: 'streaming', activity: 'working' }, transcript: [task],
};
const port = { postMessage: vi.fn(), getState: () => ({}), setState: vi.fn() };
const routes = { blocked: false, compact: vi.fn(), navigate: vi.fn(), openBtw: vi.fn(), askBtw: vi.fn() };
function Harness({ value }: { readonly value: AssistantWebviewState }) {
  const flow = useComposerFlow(port, value, vi.fn(), routes);
  return <UiEnvironmentProvider value={{ assistantName: 'Droid', copyText: async () => undefined }}>
    <Composer state={value} port={port} flow={flow} blocked={false} onFileSearch={vi.fn()} onNavigate={vi.fn()} onBtwOpen={vi.fn()}
      renderInputRow={(input, action) => <div className="v2-composer-input-row">{input}{action}</div>} />
  </UiEnvironmentProvider>;
}
const view = (value: AssistantWebviewState) => <Harness value={value} />;

it('identifies foreground delegation waits and keeps parallel or subsequent parent work distinct', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const rendered = render(view(state));
  expect(screen.getByText('Waiting for subagent…')).toBeTruthy();
  expect(screen.queryByText('Droid is working')).toBeNull();
  const command: ToolTranscriptItem = { ...task, id: 'command', toolUseId: 'command-1', toolName: 'Execute', action: 'Run checks', subagent: undefined };
  rendered.rerender(view({ ...state, transcript: [task, command] }));
  expect(screen.getByText('Droid is working')).toBeTruthy();
  expect(screen.queryByText('Waiting for subagent…')).toBeNull();
  rendered.rerender(view({ ...state, transcript: [{ ...task, status: 'completed' }], turn: { turnId: 'turn-1', status: 'streaming', activity: 'responding' } }));
  expect(screen.getByText('Droid is responding')).toBeTruthy();
  expect(screen.queryByText('Waiting for subagent…')).toBeNull();
  rendered.rerender(view({ ...state, turn: { turnId: 'turn-2', status: 'streaming', activity: 'working' } }));
  expect(screen.getByText('Droid is working')).toBeTruthy();
  expect(screen.queryByText('Waiting for subagent…')).toBeNull();
});

it('counts only active delegations and removes the wait when the parent turn settles', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const second = { ...task, id: 'delegation-2', toolUseId: 'task-2' };
  const rendered = render(view({ ...state, transcript: [task, second] }));
  expect(screen.getByText('Waiting for 2 subagents…')).toBeTruthy();
  rendered.rerender(view({ ...state, transcript: [task, { ...second, status: 'completed' }] }));
  expect(screen.getByText('Waiting for subagent…')).toBeTruthy();
  rendered.rerender(view({ ...state, turn: { turnId: 'turn-1', status: 'completed' } }));
  expect(screen.queryByText(/Waiting for .*subagent/)).toBeNull();
  expect(screen.queryByText('Droid is working')).toBeNull();
});
