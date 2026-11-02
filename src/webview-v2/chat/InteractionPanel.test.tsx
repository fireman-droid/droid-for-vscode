// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingInteraction } from './interactions/interactionStore';
import { InteractionPanel } from './InteractionPanel';

afterEach(cleanup);

describe('V2 request responses', () => {
  it('submits the Host-preferred autonomy outcome from the default Approve plan button', async () => {
    const request: PendingInteraction = {
      sessionId: 'session', turnId: 'turn', request: {
        kind: 'permission', requestId: 'plan',
        tools: [{ toolUseId: 'plan', toolName: 'ExitSpecMode', confirmationKind: 'exit_spec_mode', title: 'Plan' }],
        options: [
          { label: 'Continue with high autonomy', value: 'proceed_auto_run_high', requiresEditedSpec: false },
          { label: 'Continue with approvals', value: 'proceed_once', requiresEditedSpec: false },
        ],
      },
    };
    const actions = { onAnswer: vi.fn(), onPermission: vi.fn(), onOpenPlan: vi.fn() };
    render(<InteractionPanel requests={[request]} actions={actions} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve plan' }));
    expect(actions.onPermission).toHaveBeenCalledExactlyOnceWith(request, 'proceed_auto_run_high', undefined);
  });

  it('renders a plan as Markdown and preserves the chosen secondary approval identity', async () => {
    const user = userEvent.setup();
    const request: PendingInteraction = {
      sessionId: 'session', turnId: 'turn',
      request: { kind: 'permission', requestId: 'plan-options',
        tools: [{ toolUseId: 'exit-plan', toolName: 'ExitSpecMode', confirmationKind: 'exit_spec_mode', title: 'Review plan' }],
        editableSpecContent: '## Implementation\n\nKeep the existing Host.',
        options: [{ label: 'Approve', value: 'approve', requiresEditedSpec: false }, { label: 'Proceed with safe commands', value: 'safe', requiresEditedSpec: false }] },
    };
    const actions = { onAnswer: vi.fn(), onPermission: vi.fn(), onOpenPlan: vi.fn() };
    render(<InteractionPanel requests={[request]} actions={actions} />);
    expect(screen.getByRole('heading', { name: 'Implementation' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'More plan approval options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Proceed with safe commands' }));
    expect(actions.onPermission).toHaveBeenCalledExactlyOnceWith(request, 'safe', undefined);
  });

  it('keeps custom single-choice precedence and submits once using the original request identity', async () => {
    const user = userEvent.setup();
    const request: PendingInteraction = {
      sessionId: 'session', turnId: 'turn',
      request: {
        kind: 'ask-user', requestId: 'question', toolCallId: 'tool',
        questions: [{ index: 2, topic: 'Scope', question: 'Choose the scope', options: ['Current file', 'All files'], multiSelect: false }],
      },
    };
    const actions = { onAnswer: vi.fn(), onPermission: vi.fn(), onOpenPlan: vi.fn() };
    render(<InteractionPanel requests={[request]} actions={actions} />);
    const allFilesRadio = screen.getByRole('radio', { name: 'All files' });
    const currentFileRadio = screen.getByRole('radio', { name: 'Current file' });
    const customInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Own answer for Scope' });
    await user.click(allFilesRadio);
    expect(allFilesRadio.getAttribute('aria-checked')).toBe('true');
    await user.click(allFilesRadio);
    expect(allFilesRadio.getAttribute('aria-checked')).toBe('false');
    await user.click(allFilesRadio);
    expect(allFilesRadio.getAttribute('aria-checked')).toBe('true');
    await user.type(customInput, 'Only the webview');
    expect(allFilesRadio.getAttribute('aria-checked')).toBe('false');
    await user.click(currentFileRadio);
    expect(currentFileRadio.getAttribute('aria-checked')).toBe('true');
    expect(customInput.value).toBe('');
    await user.type(customInput, 'Only the webview');
    expect(currentFileRadio.getAttribute('aria-checked')).toBe('false');
    await user.dblClick(screen.getByRole('button', { name: 'Submit answers' }));
    expect(actions.onAnswer).toHaveBeenCalledExactlyOnceWith(request, false, [{ index: 2, answer: 'Only the webview' }]);
  });

  it('submits all selected options and custom input for multi-select questions', async () => {
    const user = userEvent.setup();
    const request: PendingInteraction = {
      sessionId: 'session', turnId: 'turn',
      request: {
        kind: 'ask-user', requestId: 'multi-question', toolCallId: 'tool',
        questions: [{
          index: 0,
          topic: '使用场景',
          question: '这个 skill 主要给谁用？（多选，决定输入来源）',
          options: ['开发提测前自测', '测试同学排测试计划', 'CI 自动生成'],
          multiSelect: false,
        }],
      },
    };
    const actions = { onAnswer: vi.fn(), onPermission: vi.fn(), onOpenPlan: vi.fn() };
    render(<InteractionPanel requests={[request]} actions={actions} />);
    await user.click(screen.getByText('开发提测前自测'));
    await user.click(screen.getByRole('checkbox', { name: '测试同学排测试计划' }));
    await user.type(screen.getByRole('textbox', { name: 'Own answer for 使用场景' }), '发版复盘');
    await user.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(actions.onAnswer).toHaveBeenCalledExactlyOnceWith(request, false, [
      { index: 0, answer: '开发提测前自测, 测试同学排测试计划, 发版复盘' },
    ]);
  });

  it('never approves an edited plan until its host-owned draft is ready', async () => {
    const user = userEvent.setup();
    const request: PendingInteraction = {
      sessionId: 'session', turnId: 'turn',
      request: {
        kind: 'permission', requestId: 'plan', tools: [],
        editableSpecContent: 'Initial plan',
        options: [{ label: 'Approve edited plan', value: 'approve-edited', requiresEditedSpec: true }],
      },
    };
    const actions = { onAnswer: vi.fn(), onPermission: vi.fn(), onOpenPlan: vi.fn() };
    const { rerender } = render(<InteractionPanel requests={[request]} actions={actions} />);
    await user.click(screen.getByRole('button', { name: 'Approve edited plan' }));
    expect(actions.onOpenPlan).toHaveBeenCalledWith(request);
    expect(actions.onPermission).not.toHaveBeenCalled();
    const ready = { ...request, planDocument: { status: 'ready' as const, content: 'Host confirmed draft' } };
    rerender(<InteractionPanel requests={[ready]} actions={actions} />);
    await user.dblClick(screen.getByRole('button', { name: 'Approve edited plan' }));
    expect(actions.onPermission).toHaveBeenCalledExactlyOnceWith(ready, 'approve-edited', 'Host confirmed draft');
  });
});
