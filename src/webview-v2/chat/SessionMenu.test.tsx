// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import { SessionMenu } from './SessionMenu';

afterEach(cleanup);

function fixture() {
  return {
    state: {
      ...initialAssistantWebviewState,
      sessions: {
        status: 'ready' as const,
        items: [
          { id: 'active', title: 'Current chat', messageCount: 2, modifiedTime: '2026-09-09T10:00:00Z', active: true, isFavorite: false },
          { id: 'previous', title: 'Previous chat', messageCount: 2, modifiedTime: '2026-09-08T10:00:00Z', active: false, isFavorite: false },
        ],
      },
    },
    actions: {
      compactPending: false, handleCompact: vi.fn(), handleRetry: vi.fn(), handleNewSession: vi.fn(),
      handleCreateWorktreeSession: vi.fn(), handleSelectSession: vi.fn(), handleRenameSession: vi.fn(),
      handleForkSession: vi.fn(), handleForkCurrentSession: vi.fn(), handleToggleFavorite: vi.fn(),
      handleArchiveSession: vi.fn(), handleUnarchiveSession: vi.fn(), handleRefreshArchived: vi.fn(), handleSearchContent: vi.fn(),
    },
    disabled: false, open: true, onOpenChange: vi.fn(),
  };
}

describe('V2 session catalog actions', () => {
  it('only renames/forks the active session and waits for catalog confirmation before another mutation', async () => {
    const user = userEvent.setup();
    const props = fixture();
    const { rerender } = render(<SessionMenu {...props} />);
    expect(screen.queryByRole('button', { name: 'Archive Current chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fork Previous chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Previous chat' })).toBeNull();
    await user.dblClick(screen.getByRole('button', { name: 'Favorite Previous chat' }));
    expect(props.actions.handleToggleFavorite).toHaveBeenCalledExactlyOnceWith('previous', true);
    expect(screen.getByRole('button', { name: 'Archive Previous chat' }).hasAttribute('disabled')).toBe(true);
    rerender(<SessionMenu {...props} state={{ ...props.state, sessions: { ...props.state.sessions } }} />);
    await user.click(screen.getByRole('button', { name: 'Archive Previous chat' }));
    expect(props.actions.handleArchiveSession).toHaveBeenCalledExactlyOnceWith('previous');
  });

  it('renders cross-workspace search hits as non-navigable text and selects only catalog sessions', async () => {
    const user = userEvent.setup();
    const props = fixture();
    render(<SessionMenu {...props} state={{ ...props.state, sessionSearch: {
      status: 'ready', query: 'needle',
      items: [
        { id: 'elsewhere', title: 'Other project match', snippet: 'External snippet', modifiedTime: null },
        { id: 'previous', title: 'Local match', snippet: 'Local snippet', modifiedTime: null },
      ],
    } }} />);
    expect(screen.getByText('Other project match').closest('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Local match/ }));
    expect(props.actions.handleSelectSession).toHaveBeenCalledExactlyOnceWith('previous');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
