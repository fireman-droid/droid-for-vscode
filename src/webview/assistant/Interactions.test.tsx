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
    await user.click(
      screen.getAllByRole('button', { name: 'Edit and allow' })[0]!,
    );
    expect(onRespond).toHaveBeenCalledWith(
      'ProceedEdit',
      'Revised spec',
    );
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
});
