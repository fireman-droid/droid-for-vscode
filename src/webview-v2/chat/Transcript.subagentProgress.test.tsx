// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
import { Transcript } from './Transcript';

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
const port = { postMessage: vi.fn() };
const view = (value: AssistantWebviewState) => <Transcript state={value} port={port} blocked={false} sendSignal={0} onFork={undefined} />;

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
