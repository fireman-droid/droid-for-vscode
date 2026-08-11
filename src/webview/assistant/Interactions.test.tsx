// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AskUserInteractionRequest,
  type PermissionInteractionRequest,
} from '../../shared/bridgeMessages';
import {
  AskUserRequestCard,
  PermissionRequestCard,
} from './Interactions';

afterEach(cleanup);

const permission: PermissionInteractionRequest = {
  kind: 'permission',
  requestId: 'permission-a',
  tools: [
    {
      toolUseId: 'tool-a',
      toolName: 'ExitSpecMode',
      confirmationKind: 'exit_spec_mode',
      title: 'Use the implementation specification',
    },
  ],
  options: [
    { label: 'Deny', value: 'deny-exact', requiresEditedSpec: false },
    {
      label: 'Edit and allow',
      value: 'ProceedEdit',
      requiresEditedSpec: true,
    },
  ],
  editableSpecContent: 'Original spec',
};

const askUser: AskUserInteractionRequest = {
  kind: 'ask-user',
  requestId: 'ask-a',
  toolCallId: 'tool-ask',
  questions: [
    {
      index: 4,
      topic: 'Framework',
      question: 'Which framework?',
      options: ['React', 'Vue'],
      multiSelect: false,
    },
    {
      index: 9,
      topic: 'Checks',
      question: 'Which checks?',
      options: ['Tests', 'Types'],
      multiSelect: true,
    },
  ],
};

describe('assistant interaction cards', () => {
  it('settles a direct permission exactly once and disables all options', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <PermissionRequestCard
        request={permission}
        onRespond={onRespond}
      />,
    );

    await user.dblClick(screen.getByRole('button', { name: 'Deny' }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('deny-exact', undefined);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Deny' })
        .disabled,
    ).toBe(true);
  });

  it('bounds and submits the exact edited specification payload', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <PermissionRequestCard
        request={permission}
        onRespond={onRespond}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Edit and allow' }),
    );
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Edit and allow',
    });
    await user.clear(editor);
    await user.type(editor, 'Revised spec');
    const submitButtons = screen.getAllByRole('button', {
      name: 'Edit and allow',
    });
    expect(submitButtons).toHaveLength(1);
    await user.click(submitButtons[0]!);
    expect(onRespond).toHaveBeenCalledWith(
      'ProceedEdit',
      'Revised spec',
    );
  });

  it('renders a Figma-style Plan hierarchy and keeps secondary approvals in the split menu', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <PermissionRequestCard
        request={{
          ...permission,
          options: [
            {
              label: 'No, keep planning',
              value: 'deny-plan',
              requiresEditedSpec: false,
            },
            {
              label: 'Edit and approve',
              value: 'approve-edited',
              requiresEditedSpec: true,
            },
            {
              label: 'Proceed with implementation',
              value: 'proceed',
              requiresEditedSpec: false,
            },
            {
              label: 'Proceed with safe commands',
              value: 'proceed-safe',
              requiresEditedSpec: false,
            },
            {
              label: 'Proceed with all commands',
              value: 'proceed-all',
              requiresEditedSpec: false,
            },
          ],
          editableSpecContent:
            '#### Goal\n\nKeep the Runtime boundary.\n\n1. Update the card.\n2. Verify it.',
        }}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Goal' })).toBeDefined();
    expect(screen.queryByText('#### Goal')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Approve plan' }),
    ).toBeDefined();
    expect(
      screen.queryByRole('button', { name: 'Proceed with safe commands' }),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'More plan approval options',
      }),
    );
    await user.click(
      screen.getByRole('menuitem', {
        name: 'Proceed with safe commands',
      }),
    );
    expect(onRespond).toHaveBeenCalledWith('proceed-safe', undefined);
  });

  it('preserves indexed single, multi, custom, and cancel answers', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const first = render(
      <AskUserRequestCard request={askUser} onRespond={onRespond} />,
    );
    await user.click(screen.getByLabelText('React'));
    await user.click(screen.getByLabelText('Tests'));
    await user.click(screen.getByLabelText('Types'));
    await user.type(
      screen.getAllByLabelText('Your own answer')[1]!,
      'Lint',
    );
    await user.dblClick(
      screen.getByRole('button', { name: 'Submit answers' }),
    );
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(false, [
      { index: 4, answer: 'React' },
      { index: 9, answer: 'Tests, Types, Lint' },
    ]);

    first.unmount();
    const onCancel = vi.fn();
    render(<AskUserRequestCard request={askUser} onRespond={onCancel} />);
    await user.dblClick(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(true, []);
  });

  it('formats an embedded questionnaire as one readable open response', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const { container } = render(
      <AskUserRequestCard
        request={{
          kind: 'ask-user',
          requestId: 'ask-embedded',
          toolCallId: 'tool-embedded',
          questions: [
            {
              index: 0,
              topic: 'Q1',
              question:
                '设置页是哪一层？\\n[topic] 范围\\n[option] Session 设置\\n[option] 全局设置\\n\\n2. [question] 页面用什么形态？\\n[topic] 形态\\n[option] 独立页面',
              options: ['Yes', 'No'],
              multiSelect: false,
            },
          ],
        }}
        onRespond={onRespond}
      />,
    );

    const questionText = container.querySelector('.dvx-question-text');
    expect(questionText?.textContent).toContain('Topic: 范围');
    expect(questionText?.textContent).toContain('• Session 设置');
    expect(questionText?.textContent).toContain(
      '2. 页面用什么形态？',
    );
    expect(questionText?.textContent).not.toContain('\\n');
    expect(questionText?.textContent).not.toContain('[option]');
    expect(screen.queryByLabelText('Yes')).toBeNull();
    expect(screen.getByText('Q1 · open response')).toBeDefined();

    await user.type(
      screen.getByPlaceholderText('Enter your answer…'),
      '不用开新页面',
    );
    await user.click(
      screen.getByRole('button', { name: 'Submit answers' }),
    );
    expect(onRespond).toHaveBeenCalledWith(false, [
      { index: 0, answer: '不用开新页面' },
    ]);
  });

  it('renders and submits an SDK open-response question', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <AskUserRequestCard
        request={{
          kind: 'ask-user',
          requestId: 'ask-open',
          toolCallId: 'tool-open',
          questions: [
            {
              index: 0,
              topic: 'Style',
              question: 'What kind of graphic would you like?',
              options: [],
              multiSelect: false,
            },
          ],
        }}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByText('Style · open response')).toBeDefined();
    const input = screen.getByPlaceholderText('Enter your answer…');
    await user.type(input, 'A warm vector illustration');
    await user.click(
      screen.getByRole('button', { name: 'Submit answers' }),
    );

    expect(onRespond).toHaveBeenCalledWith(false, [
      { index: 0, answer: 'A warm vector illustration' },
    ]);
  });
});
