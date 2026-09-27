// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_VIEWER_PROTOCOL_VERSION, type SessionViewerHostMessage, type SessionViewerSnapshotMessage } from '../../shared/protocol/sessionViewerProtocol';
import { SessionViewerApp as V2SessionViewerApp } from './SessionViewerApp';

const snapshot: SessionViewerSnapshotMessage = {
  type: 'sessionViewer.snapshot', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
  status: 'ready', target: { kind: 'daemon-session', mode: 'standard', sessionId: 'viewer-session', title: 'Worker activity' },
  items: [], truncated: false, running: true, lifecycle: 'working', stopping: false, stopError: false,
};
const publish = (message: SessionViewerHostMessage) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
});
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.dvxTheme;
  delete document.documentElement.dataset.dvxThemePreference;
});

describe.each([['V2', V2SessionViewerApp]] as const)('%s Session Viewer', (_version, SessionViewerApp) => {
  it('uses the versioned handshake and Host-owned stop, error, theme and completion states', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    render(<SessionViewerApp vscode={{ postMessage }} />);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'sessionViewer.ready', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION });
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain('Loading');
    publish(snapshot);
    await user.click(screen.getByRole('button', { name: 'Stop', exact: true }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'sessionViewer.stop', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION });
    publish({ ...snapshot, stopping: true });
    expect((screen.getByRole('button', { name: 'Stop', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Stopping…');
    await user.click(screen.getByRole('button', { name: 'Stop', exact: true }));
    expect(postMessage).toHaveBeenCalledTimes(2);
    publish({ ...snapshot, truncated: true, stopError: true });
    expect(screen.getByRole('alert').textContent).toContain('Stop failed');
    expect(screen.getByText('Older transcript items were omitted.')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Stop', exact: true }) as HTMLButtonElement).disabled).toBe(false);
    publish({ type: 'sessionViewer.theme', preference: 'auto', resolved: 'dark' });
    expect(document.documentElement.dataset.dvxTheme).toBe('dark');
    expect(document.documentElement.dataset.dvxThemePreference).toBe('auto');
    publish({ ...snapshot, running: false, lifecycle: 'completed' });
    expect(screen.queryByRole('button', { name: 'Stop', exact: true })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Completed');
  });

  it.each(['mission-readonly', 'subagent-readonly'] as const)('does not expose Stop for a running %s target', (mode) => {
    const postMessage = vi.fn();
    render(<SessionViewerApp vscode={{ postMessage }} />);
    publish({ ...snapshot, target: { kind: 'daemon-session', mode, title: 'Read-only activity' } });
    expect(screen.getByRole('status').textContent).toBe('Working');
    expect(screen.queryByRole('button', { name: 'Stop', exact: true })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('replaces the transcript with the Host unavailable reason and keeps its lifecycle', () => {
    render(<SessionViewerApp vscode={{ postMessage: vi.fn() }} />);
    publish(snapshot);
    publish({
      type: 'sessionViewer.snapshot', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      status: 'unavailable', target: snapshot.target, reason: 'This session transcript is unavailable.',
      running: false, lifecycle: 'failed', stopping: false, stopError: false,
    });
    expect(screen.getByText('This session transcript is unavailable.')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Failed');
    expect(screen.queryByRole('button', { name: 'Stop', exact: true })).toBeNull();
  });
});
