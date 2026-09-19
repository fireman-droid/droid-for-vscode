// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import { ComposerControls } from './ComposerControls';
import { getContextLabel } from '../../webview/assistant/composer/contextPresentation';

afterEach(cleanup);

it('refreshes context once on every opening, without refreshing again on status updates or while already loading', async () => {
  const user = userEvent.setup();
  const postMessage = vi.fn();
  const state = { ...initialAssistantWebviewState, sessionId: 'session', connection: { status: 'connected' as const },
    context: { status: 'ready' as const, value: { availability: 'available' as const, used: 10, remaining: 90, limit: 100 } } };
  const props = { port: { postMessage }, blocked: false, theme: { preference: 'auto' as const, resolved: 'light' as const, onPreferenceChange: vi.fn() } };
  const view = render(<ComposerControls {...props} state={state} />);
  await user.click(screen.getByRole('button', { name: 'Session controls' }));
  await user.click(screen.getByRole('button', { name: getContextLabel(state.context) }));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'session.context.refresh', sessionId: 'session' });
  const loading = { ...state, context: { ...state.context, status: 'loading' as const } };
  view.rerender(<ComposerControls {...props} state={loading} />);
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Session controls' }));
  await user.click(screen.getByRole('button', { name: getContextLabel(loading.context) }));
  expect(postMessage).toHaveBeenCalledOnce();
  view.rerender(<ComposerControls {...props} state={state} />);
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Session controls' }));
  await user.click(screen.getByRole('button', { name: getContextLabel(state.context) }));
  expect(postMessage).toHaveBeenCalledTimes(2);
});
