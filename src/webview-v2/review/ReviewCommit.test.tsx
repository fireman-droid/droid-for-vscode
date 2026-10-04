// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { gitStatusPages } from '../../shared/protocol/gitStatusPaging';
import { ReviewCommit } from './ReviewCommit';

afterEach(cleanup);
const send = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent('message', { data })));
it('requires a complete file report and includes staged files beyond page one', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewCommit port={port} sessionId="session-a" onClose={vi.fn()} />);
  const files = Array.from({ length: 205 }, (_, index) => ({ path: `${index}.txt`, status: 'modified' as const, staged: index === 204, inTurn: false }));
  const pages = gitStatusPages({ files, snapshotId: 'preview-a' });
  send({ type: 'git.status', sequence: 0, sessionId: 'session-a', turnId: 'review', branch: 'main', ...pages[0] });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit selected files' }).disabled).toBe(true);
  for (const page of pages.slice(1)) send({ type: 'git.status', sequence: 0, sessionId: 'session-a', turnId: 'review', branch: 'main', ...page });
  fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), { target: { value: 'reviewed changes' } });
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit selected files' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Select all 205 files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Commit selected files' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.commit', paths: files.map(file => file.path), message: 'reviewed changes', snapshotId: 'preview-a', mode: 'files' });
});

it('submits the reviewed index without selecting working-only files', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewCommit port={port} sessionId="session-a" initialMode="staged" onClose={vi.fn()} />);
  send({ type: 'git.status', sequence: 0, sessionId: 'session-a', turnId: 'review', branch: 'main', snapshotId: 'preview-a', files: [
    { path: 'staged.txt', status: 'modified', staged: true, inTurn: false },
    { path: 'working.txt', status: 'modified', staged: false, inTurn: false },
  ] });
  expect(screen.queryByText('working.txt')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), { target: { value: 'index only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Commit staged changes' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.commit', paths: ['staged.txt'], message: 'index only', snapshotId: 'preview-a', mode: 'staged' });
});
