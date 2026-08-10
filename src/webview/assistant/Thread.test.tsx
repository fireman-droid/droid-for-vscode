// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HistoryNotice } from './Thread';

afterEach(cleanup);

describe('HistoryNotice', () => {
  it('states unavailable history without implying completeness', () => {
    render(<HistoryNotice historyStatus="unavailable" truncated={false} />);
    expect(screen.getByRole('note').textContent).toContain(
      'Earlier CLI messages are unavailable',
    );
  });

  it('shows partial and truncation notices independently', () => {
    render(<HistoryNotice historyStatus="partial" truncated />);
    const notices = screen.getAllByRole('note');
    expect(notices).toHaveLength(2);
    expect(notices[0]!.textContent).toContain(
      'Some earlier session content is not shown',
    );
    expect(notices[1]!.textContent).toContain(
      'Older messages are not shown',
    );
  });
});
