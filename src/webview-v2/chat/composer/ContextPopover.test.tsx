// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextPopover } from './ContextPopover';
import { projectContextWindow } from '../../../runtime/capabilities/contextWindow';
import { type SessionContextState } from '../../../shared/protocol/settings';

const source = {
  used: 400_000,
  remaining: 0,
  limit: 300_000,
  lastCallCompactionTokens: 85_000,
};
const context = (lastCallCompactionTokens?: number): SessionContextState => ({
  status: 'ready',
  value: projectContextWindow({ ...source, lastCallCompactionTokens }),
});
function Popover({ state }: { state: SessionContextState }) {
  return (
    <ContextPopover
      id="context"
      context={state}
      tokenUsage={undefined}
      disabled={false}
      compactPending={false}
      onRefresh={() => undefined}
      onCompact={() => undefined}
    />
  );
}

afterEach(cleanup);
describe('compaction meter state transitions', () => {
  it('waits for model usage rather than displaying an estimate, and drops the prior meter on a fresh session', () => {
    const view = render(<Popover state={context()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Waiting for model usage')).toBeTruthy();
    view.rerender(<Popover state={context(85_000)} />);
    expect(
      screen
        .getByRole('progressbar', { name: 'Compaction progress' })
        .getAttribute('aria-valuenow'),
    ).toBe('26');
    expect(screen.getByText('26% to compaction')).toBeTruthy();
    view.rerender(<Popover state={context()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('bounds the meter at 100 without changing the actual counts and distinguishes tiny reported usage from missing usage', () => {
    const view = render(<Popover state={context(350_000)} />);
    const meter = screen.getByRole('progressbar');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
    expect(meter.getAttribute('aria-valuetext')).toContain('339,000 of 289,000');
    view.rerender(<Popover state={context(5_000)} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('<1% to compaction')).toBeTruthy();
  });
});
