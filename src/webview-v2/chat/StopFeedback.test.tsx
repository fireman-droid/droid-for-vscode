// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createHostTranscriptState, projectHostTranscriptMessage } from '../../extension/recovery/hostTranscriptState';
import { initialAssistantWebviewState } from '../state/initialState';
import { assistantWebviewReducer } from '../state/store';
import type { StoreHostMessage } from '../state/types';
import {
  isTransientNoticeLifecycleMessage, reduceTransientDiagnostic, selectVisibleNotice,
  type TransientDiagnostic,
} from '../host/transientDiagnostic';
import { TransientNotice } from './TransientNotice';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows stop failure while stopping, retains the lock, and clears feedback after confirmation', () => {
  vi.useFakeTimers();
  const warning: TransientDiagnostic = {
    type: 'runtime.diagnostic', sequence: 1, sessionId: 'session-1', turnId: 'turn-1',
    severity: 'warning', code: 'turn-stop-unconfirmed', message: 'Stop is not confirmed. Use Retry Stop.',
  };
  const state = { ...initialAssistantWebviewState, sessionId: 'session-1',
    connection: { status: 'connected' as const }, turn: { turnId: 'turn-1', status: 'stopping' as const } };
  const reduced = assistantWebviewReducer(state, { type: 'host.message', message: warning });
  expect(reduced.turn?.status).toBe('stopping');
  expect(reduced.transcript).toEqual([]);
  expect(projectHostTranscriptMessage(createHostTranscriptState('complete'), warning).transcript).toEqual([]);
  expect(isTransientNoticeLifecycleMessage(warning)).toBe(true);
  const notice = reduceTransientDiagnostic(null, warning);
  const lateMessages: StoreHostMessage[] = [
    { type: 'assistant.delta', sequence: 2, sessionId: 'session-1', turnId: 'turn-1', delta: 'Late answer' },
    { type: 'thinking.delta', sequence: 3, sessionId: 'session-1', turnId: 'turn-1', delta: 'Late thinking', segmentIndex: 0, truncated: false },
    { type: 'tool.activity', sequence: 4, sessionId: 'session-1', turnId: 'turn-1', toolUseId: 'late-tool', toolName: 'Execute', action: 'Still running', status: 'running', progressCount: 0, latestUpdateKind: null },
  ];
  const afterLateMessages = assistantWebviewReducer(reduced, { type: 'host.batch', messages: lateMessages });
  expect(afterLateMessages.turn?.status).toBe('stopping');
  expect(afterLateMessages.transcript).toEqual([]);
  expect(afterLateMessages.sequence).toBe(4);
  expect(selectVisibleNotice(notice, state.sessionId, state.turn.turnId, true)).toBe(warning);
  const view = render(<TransientNotice diagnostic={notice!} />);
  act(() => vi.advanceTimersByTime(5_000));
  expect(screen.getByRole('status').textContent).toContain('Stop is not confirmed');
  expect(selectVisibleNotice(notice, 'other-session', 'turn-1', true)).toBeNull();
  const settled = { type: 'turn.state' as const, sequence: 5, sessionId: 'session-1', turnId: 'turn-1', status: 'interrupted' as const };
  expect(assistantWebviewReducer(afterLateMessages, { type: 'host.message', message: settled }).turn?.status).toBe('interrupted');
  expect(reduceTransientDiagnostic(notice, settled)).toBeNull();
  view.rerender(<>{null}</>);
  expect(screen.queryByRole('status')).toBeNull();
});
