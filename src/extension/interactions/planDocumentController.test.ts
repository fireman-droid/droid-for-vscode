import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_EDITED_SPEC_LENGTH } from '../../shared/bridgeMessages';
import { type PermissionInteractionRequest } from '../../shared/protocol/interactions';

const mocks = vi.hoisted(() => ({
  changeListener: null as ((event: { document: MockDocument }) => void) | null,
  closeListener: null as ((document: MockDocument) => void) | null,
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
}));

interface MockDocument {
  getText(): string;
  text: string;
}

vi.mock('vscode', () => ({
  workspace: {
    onDidChangeTextDocument(listener: typeof mocks.changeListener) {
      mocks.changeListener = listener;
      return { dispose: vi.fn() };
    },
    onDidCloseTextDocument(listener: typeof mocks.closeListener) {
      mocks.closeListener = listener;
      return { dispose: vi.fn() };
    },
    openTextDocument: mocks.openTextDocument,
  },
  window: {
    showTextDocument: mocks.showTextDocument,
  },
}));

import { PlanDocumentController } from './planDocumentController';

const request: PermissionInteractionRequest = {
  kind: 'permission',
  requestId: 'plan-1',
  tools: [
    {
      toolUseId: 'tool-1',
      toolName: 'ExitSpecMode',
      confirmationKind: 'exit_spec_mode',
      title: 'Review plan',
    },
  ],
  options: [
    { label: 'Reject', value: 'cancel', requiresEditedSpec: false },
    {
      label: 'Edit plan',
      value: 'proceed_edit',
      requiresEditedSpec: true,
    },
    {
      label: 'Approve',
      value: 'proceed_once',
      requiresEditedSpec: false,
    },
  ],
  editableSpecContent: '# Original',
};

describe('PlanDocumentController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.changeListener = null;
    mocks.closeListener = null;
    mocks.openTextDocument.mockImplementation(async ({ content }: { content: string }) =>
      document(content),
    );
    mocks.showTextDocument.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['proceed_once', 'proceed_auto_run_medium'])(
    'opens one Markdown document and submits its edits when the default approval is %s', async (approval) => {
    const states: unknown[] = [];
    const controller = new PlanDocumentController((state) => states.push(state));
    controller.track('session-1', 'turn-1', { ...request, options: [
      { label: 'Approve', value: approval, requiresEditedSpec: false },
      ...request.options.filter((option) => option.value !== approval),
    ] });
    controller.open({ ...openMessage(), turnId: 'stale-turn' });
    expect(mocks.openTextDocument).not.toHaveBeenCalled();
    controller.open(openMessage());
    await vi.runAllTimersAsync();

    expect(mocks.openTextDocument).toHaveBeenCalledWith({
      language: 'markdown',
      content: '# Original',
    });
    controller.open(openMessage());
    expect(mocks.openTextDocument).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(2);

    const opened = await mocks.openTextDocument.mock.results[0]!.value;
    opened.text = '# Revised';
    mocks.changeListener?.({ document: opened });
    await vi.advanceTimersByTimeAsync(120);
    expect(states.at(-1)).toMatchObject({
      type: 'plan.document.state',
      status: 'ready',
      content: '# Revised',
    });

    expect(
      controller.prepareResponse({
        type: 'permission.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'plan-1',
        selectedOption: approval,
      }),
    ).toEqual({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'plan-1',
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised',
    });
    controller.dispose();
  });

  it('blocks approval while the editor is oversized without truncating it', async () => {
    const states: unknown[] = [];
    const controller = new PlanDocumentController((state) => states.push(state));
    controller.track('session-1', 'turn-1', request);
    controller.open(openMessage());
    await vi.runAllTimersAsync();
    const opened = await mocks.openTextDocument.mock.results[0]!.value;
    opened.text = 'x'.repeat(MAX_EDITED_SPEC_LENGTH + 1);
    mocks.changeListener?.({ document: opened });
    await vi.advanceTimersByTimeAsync(120);

    expect(states.at(-1)).toMatchObject({ status: 'too-large' });
    expect(
      controller.prepareResponse({
        type: 'permission.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'plan-1',
        selectedOption: 'proceed_once',
      }),
    ).toBeNull();
    mocks.closeListener?.(opened);
    expect(states.at(-1)).toMatchObject({ status: 'too-large' });
    expect(
      controller.prepareResponse({
        type: 'permission.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'plan-1',
        selectedOption: 'proceed_once',
      }),
    ).toBeNull();
    expect(
      controller.prepareResponse({
        type: 'permission.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'plan-1',
        selectedOption: 'cancel',
      }),
    ).toMatchObject({ selectedOption: 'cancel' });
    controller.dispose();
  });

  it('reopens a closed draft and detaches it after settlement', async () => {
    const states: unknown[] = [];
    const controller = new PlanDocumentController((state) => states.push(state));
    controller.track('session-1', 'turn-1', request);
    controller.open(openMessage());
    await vi.runAllTimersAsync();
    const opened = await mocks.openTextDocument.mock.results[0]!.value;
    opened.text = '# Kept';
    mocks.changeListener?.({ document: opened });
    await vi.advanceTimersByTimeAsync(120);
    mocks.closeListener?.(opened);
    expect(states.at(-1)).toMatchObject({ status: 'closed' });

    controller.open(openMessage());
    await vi.runAllTimersAsync();
    expect(mocks.openTextDocument).toHaveBeenLastCalledWith({
      language: 'markdown',
      content: '# Kept',
    });
    controller.settle('plan-1');
    const count = states.length;
    const reopened = await mocks.openTextDocument.mock.results[1]!.value;
    reopened.text = '# Too late';
    mocks.changeListener?.({ document: reopened });
    await vi.advanceTimersByTimeAsync(120);
    expect(states).toHaveLength(count);
    controller.dispose();
  });
});

function document(text: string): MockDocument {
  return {
    text,
    getText() {
      return this.text;
    },
  };
}

function openMessage() {
  return {
    type: 'plan.document.open' as const,
    sessionId: 'session-1',
    turnId: 'turn-1',
    requestId: 'plan-1',
  };
}
