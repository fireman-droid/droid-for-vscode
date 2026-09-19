// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TRANSIENT_NOTICE_TIMEOUT_MS,
  TransientNotice,
  reduceTransientDiagnostic,
  type TransientDiagnostic,
} from './transientNotice';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const diagnostic: TransientDiagnostic = {
  type: 'runtime.diagnostic',
  sequence: 1,
  sessionId: 'session-a',
  turnId: 'turn-a',
  severity: 'warning',
  code: 'file-not-ready',
  message: 'Droid is still working on it.',
};

describe('TransientNotice', () => {
  it('expires without adding persistent presentation', () => {
    vi.useFakeTimers();
    render(<TransientNotice diagnostic={diagnostic} />);
    expect(screen.getByRole('status').textContent).toContain(diagnostic.message);
    act(() => vi.advanceTimersByTime(TRANSIENT_NOTICE_TIMEOUT_MS));
    expect(screen.queryByText(diagnostic.message)).toBeNull();
  });

  it('clears only for the owning turn lifecycle', () => {
    expect(
      reduceTransientDiagnostic(diagnostic, {
        type: 'turn.state',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-other',
        status: 'completed',
      }),
    ).toBe(diagnostic);
    expect(
      reduceTransientDiagnostic(diagnostic, {
        type: 'host.snapshot',
        sequence: 3,
        sessionId: 'session-a',
        connection: { status: 'connected' },
        turn: { turnId: 'turn-a', status: 'streaming' },
        sessions: { status: 'ready', items: [] },
        settings: { status: 'loading', value: null },
        context: { status: 'loading', value: null },
        modelCatalog: { status: 'loading', items: [] },
        transcript: [],
        historyStatus: 'complete',
        truncated: false,
      }),
    ).toBe(diagnostic);
    expect(
      reduceTransientDiagnostic(diagnostic, {
        type: 'turn.state',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'completed',
      }),
    ).toBeNull();
  });
});
