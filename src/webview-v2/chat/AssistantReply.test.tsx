// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ProcessPresentationProvider } from './transcript/processPresentation';
import type { AssistantGroupDescriptor } from './transcript/transcriptGroups';
import { AssistantReply } from './AssistantReply';

afterEach(cleanup);

it('opens a single tool detail directly and keeps the reader choice across virtual unmounts', async () => {
  const user = userEvent.setup();
  const following = { current: { following: true } };
  const descriptor: AssistantGroupDescriptor = {
    kind: 'assistant', id: 'reply', turnId: 'turn',
    items: [{ kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'tool', toolName: 'Read', action: 'Read source', status: 'completed', progressCount: 1, latestUpdateKind: null,
      target: 'src/app.ts', resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/app.ts', callId: 'tool' }, text: 'const directDetail = true;', truncated: false } }],
  };
  const view = (visible: boolean) => <ProcessPresentationProvider messageIds={['reply']} followingRef={following}>
    {visible ? <AssistantReply descriptor={descriptor} status={{ type: 'complete', reason: 'stop' }} waiting={null} replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} /> : null}
  </ProcessPresentationProvider>;
  const { rerender } = render(view(true));
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Read.*src\/app\.ts/ }));
  expect(screen.getByRole('region', { name: 'Source preview' }).textContent).toContain('const directDetail = true;');
  expect(following.current.following).toBe(false);
  rerender(view(false));
  rerender(view(true));
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Read.*src\/app\.ts/ }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('region', { name: 'Source preview' }).textContent).toContain('const directDetail = true;');
});

it('keeps ordered individual disclosures without an intermediate thinking group', async () => {
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
  const history = screen.getByRole('button', { name: 'Process: Execution history' });
  expect(history.textContent).toContain('2 records');
  expect(history.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getAllByRole('button', { name: /^List/ })).toHaveLength(1);
  await user.click(history);
  expect(screen.queryByRole('region', { name: 'Directory listing' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  const historyContent = document.getElementById(history.getAttribute('aria-controls')!)!;
  expect(historyContent.contains(screen.getByRole('button', { name: /^Read.*src\/app\.ts/ }))).toBe(true);
  const latest = screen.getByRole('button', { name: /^List/ });
  expect(historyContent.contains(latest)).toBe(false);
  await user.click(latest);
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  rendered.rerender(view(false));
  rendered.rerender(view(true));
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  expect(screen.getByText('**Planning****Outlining**')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Source preview' })).toBeTruthy();
  expect(following.current.following).toBe(false);
  expect(screen.queryByRole('button', { name: /^Thinking history/ })).toBeNull();
  const text = rendered.container.textContent!;
  expect(text.indexOf('Planning')).toBeLessThan(text.indexOf('const value'));
  await user.click(screen.getByRole('button', { name: /^Read.*src\/app\.ts/ }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Source preview' })).toBeNull());
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  rendered.rerender(view(false));
  rendered.rerender(view(true));
  expect(screen.getByRole('button', { name: /^Read.*src\/app\.ts/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^Process:/ }));
  await waitFor(() => expect(screen.queryByText('**Planning****Outlining**')).toBeNull());
  expect(screen.getByRole('region', { name: 'Directory listing' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^List/ })).toHaveLength(1);
});

it('keeps a single command directly accessible and retains failures after the turn settles', async () => {
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
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Run fixture/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByLabelText('Command and output').closest('[aria-hidden="true"]')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: /^Run fixture/ }));
  expect(screen.getByLabelText('Command and output').textContent).toContain('Checking fixture');
  rendered.rerender(view(false));
  expect(screen.queryByRole('button', { name: /Activity/ })).toBeNull();
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
  const command = screen.getByRole('button', { name: /^Run fixture/ });
  await user.click(command);
  expect(command.getAttribute('aria-expanded')).toBe('false');
  await user.click(command);
  expect(command.getAttribute('aria-expanded')).toBe('true');
});

it.each([1, 2])('keeps the latest of %s reasoning segments independently collapsible outside history', async (count) => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn',
    items: Array.from({ length: count }, (_, index) => ({ kind: 'thinking', id: `thinking-${index}`, turnId: 'turn',
      text: `Reasoning segment ${index + 1}`, status: 'active', truncated: false })) };
  render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'running' }} waiting={null} replyText={undefined}
      completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  const trigger = screen.queryByRole('button', { name: 'Process: Execution history' });
  expect(trigger === null).toBe(count === 1);
  expect(screen.getAllByRole('button', { name: /^Thinking/ })).toHaveLength(1);
  for (let index = 0; index < count; index++) {
    expect(screen.queryByText(`Reasoning segment ${index + 1}`)).toBeNull();
  }
  if (trigger) {
    expect(trigger.textContent).toContain('1 records');
    await user.click(trigger);
    expect(screen.getByText('Reasoning segment 1')).toBeTruthy();
    expect(screen.queryByText(`Reasoning segment ${count}`)).toBeNull();
  }
  const segments = screen.getAllByRole('button', { name: /^Thinking/ });
  expect(segments).toHaveLength(count);
  await user.click(segments.at(-1)!);
  expect(screen.getByText(`Reasoning segment ${count}`)).toBeTruthy();
  await user.click(segments[0]!);
  await waitFor(() => expect(screen.queryByText('Reasoning segment 1')).toBeNull());
  if (count > 1) expect(screen.getByText('Reasoning segment 2')).toBeTruthy();
  if (trigger) expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

it('retains explicit reasoning disclosure through appended text, completion and virtual eviction inside mixed activity', async () => {
  const user = userEvent.setup();
  const following = { current: { following: true } };
  const view = (text: string, running = true, visible = true) => {
    const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
      { kind: 'thinking', id: 'reasoning', turnId: 'turn', text, status: running ? 'active' : 'complete', durationMs: 2_000, truncated: false },
      { kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'read-call', toolName: 'Read', action: 'Read file', status: 'completed',
        progressCount: 0, latestUpdateKind: null, filePath: 'src/app.ts' },
    ] };
    return <ProcessPresentationProvider messageIds={['reply']} followingRef={following}>
      {visible ? <AssistantReply descriptor={descriptor} status={running ? { type: 'running' } : { type: 'complete', reason: 'stop' }}
        waiting={null} replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} /> : null}
    </ProcessPresentationProvider>;
  };
  const rendered = render(view('Initial reasoning.'));
  const activity = screen.getByRole('button', { name: /^Process:/ });
  expect(activity.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /^Thinking/ })).toBeNull();
  await user.click(activity);
  expect(activity.getAttribute('aria-expanded')).toBe('true');
  const thinking = screen.getByRole('button', { name: /^Thinking/ });
  await user.click(thinking);
  expect(thinking.getAttribute('aria-expanded')).toBe('false');
  await user.click(thinking);
  expect(screen.getByText('Initial reasoning.')).toBeTruthy();
  rendered.rerender(view('Initial reasoning. More evidence.'));
  expect(screen.getByRole('button', { name: /^Process:/ }).getAttribute('aria-expanded')).toBe('true');
  await waitFor(() => expect(rendered.container.textContent).toContain('Initial reasoning. More evidence.'));
  rendered.rerender(view('Initial reasoning. More evidence.', false));
  expect(screen.getByRole('button', { name: /^Process:/ }).getAttribute('aria-expanded')).toBe('true');
  rendered.rerender(view('Initial reasoning. More evidence.', false, false));
  rendered.rerender(view('Initial reasoning. More evidence.', false));
  expect(rendered.container.textContent).toContain('Initial reasoning. More evidence.');
  expect(screen.getByRole('button', { name: /^Process:/ }).getAttribute('aria-expanded')).toBe('true');
  expect(following.current.following).toBe(false);
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

it('keeps failed commands and their output accessible while mixed activity is collapsed', async () => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'thinking', id: 'reason', turnId: 'turn', text: 'Inspect the failure.', status: 'complete', truncated: false },
    { kind: 'tool', id: 'command', turnId: 'turn', toolUseId: 'command-call', toolName: 'Execute', action: 'Run fixture', status: 'failed',
      progressCount: 1, latestUpdateKind: null, detailKind: 'command', detail: 'node missing.mjs', errorMessage: 'Module not found' },
  ] };
  render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'complete', reason: 'stop' }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  const process = screen.getByRole('button', { name: 'Process: Execution history' });
  expect(process.getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: /^Run fixture/ }));
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
  await user.click(process);
  expect(screen.getAllByRole('button', { name: /^Run fixture/ })).toHaveLength(1);
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
});

it('keeps the full history open as new thinking segments arrive', async () => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'thinking', id: 'first', turnId: 'turn', text: 'First observation.', status: 'complete', durationMs: 2_000, truncated: false },
    { kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'read-call', toolName: 'Read', action: 'Read file', status: 'completed', progressCount: 0, latestUpdateKind: null },
  ] };
  const view = (next: boolean) => <ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={next ? { ...descriptor, items: [...descriptor.items,
      { kind: 'thinking', id: 'next', turnId: 'turn', text: 'Next observation.', status: 'active', truncated: false }] } : descriptor}
      status={{ type: 'running' }} waiting={null} replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>;
  const { rerender } = render(view(false));
  await user.click(screen.getByRole('button', { name: /^Process:/ }));
  await user.click(screen.getByRole('button', { name: /Thought for 2s/ }));
  await waitFor(() => expect(screen.queryByText('First observation.')).toBeNull());
  rerender(view(true));
  expect(screen.queryByRole('button', { name: /^Thinking history/ })).toBeNull();
  expect(screen.queryByText('Next observation.')).toBeNull();
  expect(screen.getByRole('button', { name: /^Thinking/ }).getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: /^Thinking/ }));
  expect(screen.getByText('Next observation.')).toBeTruthy();
  expect(screen.queryByText('First observation.')).toBeNull();
  expect(screen.getByRole('button', { name: /Thought for 2s/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: /^Process:/ }).getAttribute('aria-expanded')).toBe('true');
});

it('keeps the newest operation outside history while preserving choices as it moves into history', async () => {
  const user = userEvent.setup();
  const items: AssistantGroupDescriptor['items'] = [
    { kind: 'tool', id: 'script', turnId: 'turn', toolUseId: 'script-call', toolName: 'Script', action: 'Script', status: 'running', progressCount: 0, latestUpdateKind: null },
    { kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'read-call', toolName: 'Read', action: 'Read file', status: 'completed', progressCount: 1, latestUpdateKind: null,
      target: 'src/latest.ts', resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/latest.ts', callId: 'read-call' }, text: 'const latest = true;', truncated: false } },
    { kind: 'thinking', id: 'next', turnId: 'turn', text: 'The next observation.', status: 'active', truncated: false },
  ];
  const view = (count: number) => <ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={{ kind: 'assistant', id: 'reply', turnId: 'turn', items: items.slice(0, count) }}
      status={{ type: 'running' }} waiting={null} replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>;
  const { rerender } = render(view(1));
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  rerender(view(2));
  const process = screen.getByRole('button', { name: 'Process: Execution history' });
  expect(process.getAttribute('aria-expanded')).toBe('false');
  expect(process.textContent).toContain('1 records');
  expect(screen.getAllByRole('button', { name: /^Read.*src\/latest\.ts/ })).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Source preview' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Read.*src\/latest\.ts/ }));
  await user.click(process);
  expect(process.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('region', { name: 'Source preview' }).textContent).toContain('const latest = true;');
  rerender(view(3));
  expect(process.getAttribute('aria-expanded')).toBe('true');
  expect(process.textContent).toContain('2 records');
  expect(screen.getAllByRole('button', { name: /^Read.*src\/latest\.ts/ })).toHaveLength(1);
  expect(screen.getByRole('region', { name: 'Source preview' }).textContent).toContain('const latest = true;');
  const latest = screen.getByRole('button', { name: /^Thinking/ });
  expect(latest.getAttribute('aria-expanded')).toBe('false');
  const historyContent = document.getElementById(process.getAttribute('aria-controls')!)!;
  expect(historyContent.contains(latest)).toBe(false);
  expect(historyContent.contains(screen.getByRole('button', { name: /^Read.*src\/latest\.ts/ }))).toBe(true);
  await user.click(process);
  expect(process.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: /^Thinking/ })).toBe(latest);
  await user.click(latest);
  expect(screen.getByText('The next observation.')).toBeTruthy();
});

it('keeps assistant prose in order and places earlier process groups entirely in history', async () => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'assistant', id: 'intro', turnId: 'turn', text: 'First, inspect the implementation.' },
    { kind: 'thinking', id: 'earlier-thought', turnId: 'turn', text: 'Earlier reasoning.', status: 'complete', truncated: false },
    { kind: 'assistant', id: 'progress', turnId: 'turn', text: 'The source confirms the next step.' },
    { kind: 'tool', id: 'read', turnId: 'turn', toolUseId: 'read-call', toolName: 'Read', action: 'Read file', status: 'completed',
      progressCount: 0, latestUpdateKind: null, target: 'src/earlier.ts' },
    { kind: 'assistant', id: 'next-step', turnId: 'turn', text: 'Now verify the result.' },
    { kind: 'thinking', id: 'latest-thought', turnId: 'turn', text: 'Latest reasoning.', status: 'active', truncated: false },
  ] };
  const view = render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'running' }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  const histories = screen.getAllByRole('button', { name: 'Process: Execution history' });
  expect(histories).toHaveLength(2);
  expect(histories.every((history) => history.getAttribute('aria-expanded') === 'false')).toBe(true);
  expect(histories.every((history) => history.textContent?.includes('1 records'))).toBe(true);
  expect(screen.queryByText('Earlier reasoning.')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Read.*src\/earlier\.ts/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Thinking/ })).toHaveLength(1);
  const first = screen.getByText('First, inspect the implementation.');
  const progress = screen.getByText('The source confirms the next step.');
  const next = screen.getByText('Now verify the result.');
  const latest = screen.getByRole('button', { name: /^Thinking/ });
  const ordered = [first, histories[0]!, progress, histories[1]!, next, latest];
  for (let index = 1; index < ordered.length; index++) {
    expect(ordered[index - 1]!.compareDocumentPosition(ordered[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  await user.click(histories[0]!);
  expect(screen.getByText('Earlier reasoning.')).toBeTruthy();
  await user.click(histories[1]!);
  expect(screen.getByRole('button', { name: /^Read.*src\/earlier\.ts/ })).toBeTruthy();
  expect(screen.queryByText('Latest reasoning.')).toBeNull();
  await user.click(latest);
  expect(view.container.textContent).toContain('Latest reasoning.');
});

it('keeps a historical failure accessible without duplicating it when history opens', async () => {
  const user = userEvent.setup();
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'tool', id: 'failed', turnId: 'turn', toolUseId: 'failed-call', toolName: 'Execute', action: 'Run failed check', status: 'failed',
      progressCount: 1, latestUpdateKind: null, detailKind: 'command', detail: 'node missing.mjs', errorMessage: 'Module not found' },
    { kind: 'thinking', id: 'latest', turnId: 'turn', text: 'Investigating the missing module.', status: 'active', truncated: false },
  ] };
  render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'running' }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  const history = screen.getByRole('button', { name: 'Process: Execution history' });
  expect(history.getAttribute('aria-expanded')).toBe('false');
  expect(history.textContent).toContain('1 failed');
  await user.click(screen.getByRole('button', { name: /^Run failed check/ }));
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
  await user.click(history);
  expect(screen.getAllByRole('button', { name: /^Run failed check/ })).toHaveLength(1);
  expect(screen.getByLabelText('Command and output').textContent).toContain('Module not found');
  expect(screen.getByRole('button', { name: /^Thinking/ }).getAttribute('aria-expanded')).toBe('false');
});

it.each([
  ['cancelled', 'stopped'],
  ['error', 'failed'],
] as const)('shows the %s turn state even when its only operation already completed', (reason, label) => {
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'tool', id: 'check', turnId: 'turn', toolUseId: 'check-call', toolName: 'Execute', action: 'Run check', status: 'completed',
      progressCount: 0, latestUpdateKind: null, detailKind: 'command', detail: 'node check.mjs' },
  ] };
  render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'incomplete', reason }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Run check/ })).toBeTruthy();
  expect(screen.getAllByText(new RegExp(`^${label}$`, 'i'))).toHaveLength(1);
});

it.each([
  ['cancelled', 'stopped'],
  ['error', 'failed'],
] as const)('does not repeat the %s turn state already shown by its only operation', (reason, status) => {
  const descriptor: AssistantGroupDescriptor = { kind: 'assistant', id: 'reply', turnId: 'turn', items: [
    { kind: 'tool', id: 'check', turnId: 'turn', toolUseId: 'check-call', toolName: 'Execute', action: 'Run check', status,
      progressCount: 0, latestUpdateKind: null, detailKind: 'command', detail: 'node check.mjs' },
  ] };
  render(<ProcessPresentationProvider messageIds={['reply']} followingRef={{ current: { following: true } }}>
    <AssistantReply descriptor={descriptor} status={{ type: 'incomplete', reason }} waiting={null}
      replyText={undefined} completedAt={undefined} regenerate={undefined} fork={undefined} />
  </ProcessPresentationProvider>);
  expect(screen.queryByRole('button', { name: /^Process:/ })).toBeNull();
  const operation = screen.getByRole('button', { name: /^Run check/ });
  const states = screen.getAllByText(new RegExp(`^${status}$`, 'i'));
  expect(states).toHaveLength(1);
  expect(operation.contains(states[0]!)).toBe(true);
});
