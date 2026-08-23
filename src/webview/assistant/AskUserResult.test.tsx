// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AskUserResult } from './AskUserResult';

afterEach(cleanup);

describe('AskUserResult', () => {
  it('renders compact topic and answer rows', () => {
    render(
      <AskUserResult
        data={{
          status: 'answered',
          answers: [{ topic: 'Library', answer: 'React' }],
        }}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Your answers' }).textContent,
    ).toContain('LibraryReact');
  });

  it('renders a compact cancellation record', () => {
    render(<AskUserResult data={{ status: 'cancelled' }} />);
    expect(
      screen.getByRole('region', { name: 'Question cancelled' })
        .textContent,
    ).toContain('Cancelled');
  });
});
