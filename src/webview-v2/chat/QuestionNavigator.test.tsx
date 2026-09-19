// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { findActiveQuestionIndex, questionPreview } from '../../webview/assistant/thread/navigation/questionNavigation';
import { QuestionNavigator } from './QuestionNavigator';

afterEach(cleanup);

it('samples a long history without losing adjacent question navigation or the last question at the bottom', async () => {
  const user = userEvent.setup();
  const items = Array.from({ length: 150 }, (_, index) => ({ key: `question-${index}`, preview: questionPreview(`Question ${index + 1}`, index) }));
  const navigate = vi.fn();
  const { rerender } = render(<QuestionNavigator items={items} activeIndex={74} onNavigate={navigate} />);
  expect(screen.getAllByRole('button', { name: /Jump to question/ })).toHaveLength(21);
  for (const index of [0, 73, 74, 75, 149]) expect(screen.getByRole('button', { name: `Jump to question ${index + 1}: Question ${index + 1}` })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Previous question' }));
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(screen.getByRole('button', { name: 'Jump to question 150: Question 150' }));
  expect(navigate.mock.calls.map(([key]) => key)).toEqual(['question-73', 'question-75', 'question-149']);
  const active = findActiveQuestionIndex(items.map((_, index) => index * 100), 14899.5, 14900);
  rerender(<QuestionNavigator items={items} activeIndex={active} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(navigate).toHaveBeenCalledTimes(3);
});
