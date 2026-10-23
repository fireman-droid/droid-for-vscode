// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineQuestion, type InlineQuestionEntry } from '../../src/review/InlineQuestion';

afterEach(cleanup);

it('follows new content in the shared viewport until the reader scrolls up, then resumes after sending', () => {
  const onSend = vi.fn();
  const props = { draft: 'Follow up', onDraft: vi.fn(), busy: false, disabled: false, message: null,
    onSend, onStop: vi.fn(), onClose: vi.fn(), maxLength: 4000, focusRequested: false, onFocused: vi.fn() };
  const entries: InlineQuestionEntry[] = [];
  const view = render(<InlineQuestion {...props} entries={entries} />);
  const viewport = view.container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!;
  let height = 400, top = 0;
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => 100 },
    scrollHeight: { configurable: true, get: () => height },
    scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 100)); } },
  });
  const first: InlineQuestionEntry = { id: '1', question: 'Explain this code', answer: '', state: 'streaming', message: null };
  view.rerender(<InlineQuestion {...props} entries={[first]} />);
  expect(viewport.scrollTop).toBe(300);
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  height = 600;
  view.rerender(<InlineQuestion {...props} entries={[{ ...first, state: 'done' }]} />);
  expect(viewport.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(onSend).toHaveBeenCalledOnce();
  height = 700;
  view.rerender(<InlineQuestion {...props} entries={[first, { ...first, id: '2', question: props.draft }]} />);
  expect(viewport.scrollTop).toBe(600);
});
