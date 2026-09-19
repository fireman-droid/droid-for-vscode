// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ProcessPresentationProvider } from '../../webview/assistant/transcript/processPresentation';
import type { AssistantGroupDescriptor } from '../../webview/assistant/transcript/transcriptGroups';
import { AssistantReply } from './AssistantReply';

afterEach(cleanup);

it('keeps the process disclosure across virtual unmounts and pauses following on a reader toggle', async () => {
  const user = userEvent.setup();
  const following = { current: { following: true } };
  const descriptor: AssistantGroupDescriptor = {
    kind: 'assistant', id: 'reply', turnId: 'turn',
    items: [{ kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'tool', toolName: 'Read', action: 'Read source', status: 'completed', progressCount: 1, latestUpdateKind: null }],
  };
  const view = (visible: boolean) => <ProcessPresentationProvider messageIds={['reply']} followingRef={following}>
    {visible ? <AssistantReply descriptor={descriptor} status={{ type: 'complete', reason: 'stop' }} waiting={null} replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} renderItem={() => <p>Read detail</p>} /> : null}
  </ProcessPresentationProvider>;
  const { rerender } = render(view(true));
  await user.click(screen.getByRole('button', { name: /1 read/ }));
  expect(screen.getByText('Read detail')).toBeTruthy();
  expect(following.current.following).toBe(false);
  rerender(view(false));
  rerender(view(true));
  expect(screen.getByRole('button', { name: /1 read/ }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Read detail')).toBeTruthy();
});

it('keeps independent inline activity disclosures across eviction without moving the reader', async () => {
  const user = userEvent.setup();
  const following = { current: { following: true } };
  const descriptor: AssistantGroupDescriptor = {
    kind: 'assistant', id: 'reply', turnId: 'turn',
    items: [
      { kind: 'thinking', id: 'thinking', turnId: 'turn', text: '**Planning****Outlining**', status: 'complete', durationMs: 800, truncated: false },
      { kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'read-call', toolName: 'Read', action: 'Read source', status: 'completed', durationMs: 300, progressCount: 1, latestUpdateKind: null, target: 'src/app.ts', resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/app.ts', callId: 'read-call' }, text: 'const value = true;', truncated: false } },
      { kind: 'tool', id: 'list', turnId: 'turn', toolUseId: 'list-call', toolName: 'LS', action: 'List files', status: 'completed', durationMs: 500, progressCount: 1, latestUpdateKind: null, target: '.', resultPreview: { availability: 'available', source: { tool: 'LS', path: '.', callId: 'list-call' }, text: 'src\npackage.json', truncated: false } },
    ],
  };
  const view = (visible: boolean) => <ProcessPresentationProvider messageIds={['reply']} followingRef={following}>
    {visible ? <AssistantReply descriptor={descriptor} status={{ type: 'complete', reason: 'stop' }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} /> : null}
  </ProcessPresentationProvider>;
  const rendered = render(view(true));
  await user.click(screen.getByRole('button', { name: /1 read, 1 listing/ }));
  expect(screen.queryByRole('region', { name: 'Directory listing' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Source preview' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /List.*\./ }));
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Read.*src\/app\.ts/ }));
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  rendered.rerender(view(false));
  rendered.rerender(view(true));
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Thought for 0\.8s/ }));
  expect(rendered.container.textContent).toContain('Planning Outlining');
  expect(rendered.container.textContent).not.toContain('****');
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  expect(following.current.following).toBe(false);
  await user.click(screen.getByRole('button', { name: /Read.*src\/app\.ts/ }));
  expect(screen.queryByRole('region', { name: 'Source preview' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
});

it('includes commands in the work disclosure and retains failures after the turn settles', async () => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = {
    kind: 'assistant', id: 'reply', turnId: 'turn',
    items: [
      { kind: 'tool', id: 'command', turnId: 'turn', toolUseId: 'command-call', toolName: 'Execute', action: 'Run fixture', status: 'running', progressCount: 1, latestUpdateKind: null, detailKind: 'command', detail: 'node missing-file.mjs', outputTail: 'Checking fixture' },
    ],
  };
  const following = { current: { following: true } };
  const view = (running: boolean) => <ProcessPresentationProvider messageIds={['reply']} followingRef={following}>
    <AssistantReply descriptor={running ? descriptor : { ...descriptor, items: [{ ...descriptor.items[0] as Extract<typeof descriptor.items[number], { kind: 'tool' }>, status: 'failed', errorMessage: 'Module not found' }] }}
      status={running ? { type: 'running' } : { type: 'complete', reason: 'stop' }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>;
  const rendered = render(view(true));
  expect(screen.getByLabelText('Command and output').textContent).toContain('Checking fixture');
  rendered.rerender(view(false));
  await user.click(screen.getByRole('button', { name: /Worked.*1 tool.*1 failed/ }));
  await user.click(screen.getByRole('button', { name: /Run fixture/ }));
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
});

it('copies the whole reply and omits timestamps for already-settled history', async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [{ kind: 'assistant', id: 'last-segment', turnId: 'turn', text: 'Second segment' }] };
  const { container } = render(<AssistantReply descriptor={descriptor} status={{ type: 'complete', reason: 'stop' }} waiting={null}
    replyText={'First segment\n\nSecond segment'} completedAt={undefined} regenerate={undefined} fork={undefined} renderItem={() => <p>Second segment</p>} />);
  await user.click(screen.getByRole('button', { name: 'Copy reply' }));
  expect(clipboard).toHaveBeenCalledWith('First segment\n\nSecond segment');
  expect(container.querySelector('time')).toBeNull();
});
