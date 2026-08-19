// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_VIEWER_PROTOCOL_VERSION } from '../../shared/sessionViewerProtocol';
import { SessionViewerApp } from './SessionViewerApp';

afterEach(cleanup);

const target = {
  kind: 'daemon-session' as const,
  mode: 'standard' as const,
  sessionId: 'exec-1',
  title: 'Worker Session',
};

function send(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('SessionViewerApp', () => {
  it('boots read-only, renders the shared transcript, and requests Stop', async () => {
    const postMessage = vi.fn();
    render(<SessionViewerApp vscode={{ postMessage }} />);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'sessionViewer.ready',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });

    send({
      type: 'sessionViewer.snapshot',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      status: 'ready',
      target,
      items: [{ id: 'u1', kind: 'user', text: 'Investigate runtime' }],
      truncated: false,
      running: true,
      stopping: false,
      stopError: false,
    });
    expect(await screen.findByText('Worker Session')).toBeDefined();
    expect(screen.getByText('Investigate runtime')).toBeDefined();
    expect(screen.queryByLabelText('Message Droid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
  });

  it('retains final content after settlement and removes Stop', async () => {
    render(<SessionViewerApp vscode={{ postMessage: vi.fn() }} />);
    send({
      type: 'sessionViewer.snapshot',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      status: 'ready',
      target,
      items: [
        {
          id: 'a1',
          kind: 'assistant',
          turnId: 'turn-1',
          text: 'Finished report',
        },
      ],
      truncated: false,
      running: false,
      stopping: false,
      stopError: false,
    });
    expect(await screen.findByText('Finished')).toBeDefined();
    expect(screen.getByText('Finished report')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('never renders Stop for a running Mission Worker', async () => {
    render(<SessionViewerApp vscode={{ postMessage: vi.fn() }} />);
    send({
      type: 'sessionViewer.snapshot',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      status: 'ready',
      target: {
        kind: 'daemon-session',
        mode: 'mission-readonly',
        title: 'Worker Session',
      },
      items: [],
      truncated: false,
      running: true,
      stopping: false,
      stopError: false,
    });
    expect(await screen.findByText('Working')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
