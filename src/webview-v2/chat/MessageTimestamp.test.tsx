// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageTimestamp } from '@droidvisx/chat-ui/chat/MessageTimestamp';
import { QuestionCardView } from '@droidvisx/chat-ui/chat/QuestionCardView';
import { ReplyView } from '@droidvisx/chat-ui/chat/ReplyView';
import { TooltipProvider } from '@droidvisx/chat-ui/ui/overlays';

const recorded = new Date(2026, 8, 26, 18, 47, 15);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows a recorded date, seconds and timezone on hover while retaining a compact relative label', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(recorded.getTime() + 5 * 60_000);
  const user = userEvent.setup();
  render(<TooltipProvider delayDuration={0}><MessageTimestamp completedAt={recorded.getTime()} /></TooltipProvider>);
  const time = screen.getByText('5m ago');
  expect(time.getAttribute('datetime')).toBe(recorded.toISOString());
  expect(screen.queryByRole('tooltip')).toBeNull();
  await user.hover(time);
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip.textContent).toContain('2026');
  expect(tooltip.textContent).toContain('47:15');
  expect(tooltip.textContent).toBe(time.getAttribute('aria-label'));
});

it('opens the exact time with keyboard focus and preserves it across a remount', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(recorded.getTime() + 5 * 60_000);
  const user = userEvent.setup();
  const view = () => <TooltipProvider delayDuration={0}><MessageTimestamp completedAt={recorded.getTime()} /></TooltipProvider>;
  const first = render(view());
  await user.tab();
  const exact = (await screen.findByRole('tooltip')).textContent;
  first.unmount();
  vi.spyOn(Date, 'now').mockReturnValue(recorded.getTime() + 2 * 3_600_000);
  render(view());
  expect(screen.getByText('2h ago').getAttribute('aria-label')).toBe(exact);
});

it.each([null, Number.NaN, 0])('does not manufacture a time for missing or invalid timestamp %s', (timestamp) => {
  render(<MessageTimestamp completedAt={timestamp} />);
  expect(screen.getByText('Time unavailable')).toBeTruthy();
  expect(screen.queryByText('just now')).toBeNull();
  expect(document.querySelector('time')).toBeNull();
});

it('keeps sent message time when opening its editor', () => {
  vi.spyOn(Date, 'now').mockReturnValue(recorded.getTime() + 5 * 60_000);
  const item = { id: 'user', messageId: 'message', text: 'Question', timestamp: recorded.getTime() };
  const editor = { draft: null, selection: { current: null }, begin: vi.fn(), cancel: vi.fn(), update: vi.fn() };
  const view = render(<TooltipProvider><QuestionCardView item={item} editor={editor} canResend onResend={vi.fn()} /></TooltipProvider>);
  const time = screen.getByText('5m ago').getAttribute('datetime');
  view.rerender(<TooltipProvider><QuestionCardView item={item} editor={{ ...editor,
    draft: { messageId: 'message', text: 'Edited', phase: 'editing', notice: null } }} canResend onResend={vi.fn()} /></TooltipProvider>);
  expect(screen.getByLabelText('Edit message and resend')).toBeTruthy();
  expect(screen.getByText('5m ago').getAttribute('datetime')).toBe(time);
});

it('shows recorded time in the history viewer without exposing reply actions', () => {
  vi.spyOn(Date, 'now').mockReturnValue(recorded.getTime() + 5 * 60_000);
  const view = render(<TooltipProvider><ReplyView readOnly replyText="Answer" completedAt={recorded.getTime()}>Answer</ReplyView></TooltipProvider>);
  expect(screen.getByText('5m ago')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy reply' })).toBeNull();
  view.rerender(<TooltipProvider><ReplyView running replyText="Answer" completedAt={recorded.getTime()}>Answer</ReplyView></TooltipProvider>);
  expect(screen.queryByText('5m ago')).toBeNull();
});
