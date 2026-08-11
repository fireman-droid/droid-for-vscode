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

  it('combines partial history and local trimming into one truthful notice', () => {
    render(<HistoryNotice historyStatus="partial" truncated />);
    const notices = screen.getAllByRole('note');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toContain(
      'Some earlier session content is unavailable',
    );
    expect(notices[0]!.textContent).toContain('were trimmed');
  });

  it('distinguishes partial public history from local trimming', () => {
    const first = render(
      <HistoryNotice historyStatus="partial" truncated={false} />,
    );
    expect(screen.getByRole('note').textContent).toContain(
      'public Droid history',
    );
    first.unmount();

    render(<HistoryNotice historyStatus="complete" truncated />);
    expect(screen.getByRole('note').textContent).toContain(
      'local display',
    );
  });
});
