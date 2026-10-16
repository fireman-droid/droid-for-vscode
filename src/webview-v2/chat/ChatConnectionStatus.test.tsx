// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatConnectionStatus } from './ChatConnectionStatus';
import type { SessionRecoveryStatus } from './ConnectionFeedback';
import { TooltipProvider } from '../ui/overlays';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('explains a blocked IDE reconnect and retries the IDE channel when the task becomes idle', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const port = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const recovery: SessionRecoveryStatus = {
    active: false, failed: false, pending: false, timedOut: false, waiting: false,
    canReconnect: true, reconnect: vi.fn(), refresh: { pending: false, outcome: null, refresh: vi.fn() },
  };
  const waiting = 'The background task is still running. Wait for it to finish or stop it before reconnecting IDE.';
  const view = (busy: boolean) => <TooltipProvider><ChatConnectionStatus
    connection={{ status: 'connected' }} ide={{ status: 'error', canReconnect: !busy, message: waiting }}
    sessionId="session-1" blocked={busy} working={busy} port={port} recovery={recovery}
  /></TooltipProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain(waiting);
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain('IDE offline');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect(port.postMessage).not.toHaveBeenCalledWith({ type: 'ide.reconnect', sessionId: 'session-1' });
  rerender(view(false));
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'ide.reconnect', sessionId: 'session-1' });
  expect(recovery.reconnect).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
});

it('explains model failure without offering an unrelated IDE reconnect, and clears after confirmed recovery', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const port = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const recovery: SessionRecoveryStatus = {
    active: false, failed: false, pending: false, timedOut: false, waiting: false,
    canReconnect: false, reconnect: vi.fn(), refresh: { pending: false, outcome: null, refresh: vi.fn() },
  };
  const view = (failed: boolean) => <TooltipProvider><ChatConnectionStatus
    connection={{ status: 'connected', ...(failed ? { modelRequestFailed: true } : {}) }}
    ide={{ status: 'connected', canReconnect: false }} sessionId="session-1" blocked={false}
    working={false} port={port} recovery={recovery}
  /></TooltipProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain('last model request failed to connect');
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain('local Droid runtime is connected');
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  rerender(view(false));
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain('Online');
});
