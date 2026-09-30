// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemPromptDialog } from './SystemPromptDialog';
import type { ChatPort } from '../host/chatIntent';
import type { SystemPromptResponse } from '../../shared/protocol/systemPromptProtocol';

afterEach(cleanup);
function reply(message: SystemPromptResponse) { act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); }); }

describe('system prompt confirmation', () => {
  it('loads only its own response and shows saved only after the Host acknowledges it', () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    render(<SystemPromptDialog open port={{ postMessage } as unknown as ChatPort} onOpenChange={close} />);
    const requestId = postMessage.mock.calls[0][0].requestId;
    reply({ type: 'systemPrompt.state', sequence: 1, requestId: 'stale-request', preference: { mode: 'append', text: 'Stale' }, error: null });
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true);
    reply({ type: 'systemPrompt.state', sequence: 2, requestId, preference: { mode: 'append', text: 'Saved instruction' }, error: null });
    fireEvent.change(screen.getByLabelText('Additional instructions'), { target: { value: 'Updated instruction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for new sessions' }));
    expect(postMessage.mock.calls[1][0]).toMatchObject({ type: 'systemPrompt.save', preference: { mode: 'append', text: 'Updated instruction' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    reply({ type: 'systemPrompt.state', sequence: 3, requestId: postMessage.mock.calls[1][0].requestId, preference: { mode: 'append', text: 'Updated instruction' }, error: null });
    expect(screen.getByRole('status').textContent).toContain('Saved. Start a new session');
  });

  it('preserves the draft and allows retry after a save failure', () => {
    const postMessage = vi.fn();
    render(<SystemPromptDialog open port={{ postMessage } as unknown as ChatPort} onOpenChange={vi.fn()} />);
    reply({ type: 'systemPrompt.state', sequence: 1, requestId: postMessage.mock.calls[0][0].requestId, preference: { mode: 'replace', text: 'Original' }, error: null });
    fireEvent.change(screen.getByLabelText('Replacement system prompt'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for new sessions' }));
    reply({ type: 'systemPrompt.state', sequence: 2, requestId: postMessage.mock.calls[1][0].requestId, preference: { mode: 'replace', text: 'Original' }, error: 'Storage unavailable' });
    expect(screen.getByRole('alert').textContent).toContain('Storage unavailable');
    expect((screen.getByLabelText('Replacement system prompt') as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect((screen.getByRole('button', { name: 'Save for new sessions' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
