import { describe, expect, it, vi } from 'vitest';

import {
  attachmentsMessages,
  available,
  catalogEntry,
  createCatalog,
  createController,
  createMemoryPersistence,
  createMockRuntime,
  deferred,
  queueAdd,
  queueStates,
  ready,
  send,
  SessionRecoveryStore,
  snapshots,
  stop,
  successfulTurn,
  turnStates,
  waitForConnected,
} from './controllerTestHarness';

describe('ChatController queued messages', () => {
  it('restores queued prompts as a paused queue after a reload', async () => {
    const persistence = createMemoryPersistence();
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    queueAdd(controller, 'session-1', 'queued-2', 'Second queued');
    // Reload: dispose flushes the queue texts with the checkpoint.
    await controller.dispose();
    release.resolve();

    const resumed = createMockRuntime();
    resumed.initialize.mockResolvedValue(available('session-1'));
    const second = createController(
      () => resumed,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );
    ready(second.controller);
    await waitForConnected(second.messages);

    // Restored text-only and paused: nothing auto-dispatches into the
    // reloaded session until the user resumes.
    expect(queueStates(second.messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      items: [
        expect.objectContaining({ text: 'First queued' }),
        expect.objectContaining({ text: 'Second queued' }),
      ],
      paused: 'dispatch-blocked',
    });
    expect(
      second.messages.some(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'queued-messages-restored',
      ),
    ).toBe(true);
    expect(resumed.sendTurn).not.toHaveBeenCalled();
  });

  it('clears the persisted queue when a session switch discards it', async () => {
    const persistence = createMemoryPersistence();
    const recovery = new SessionRecoveryStore(persistence, 'recovery', 0);
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const replacement = createMockRuntime();
    replacement.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn()
      .mockReturnValueOnce(runtime)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    expect(recovery.readQueuedTexts('session-1')).toEqual([
      'First queued',
    ]);
    // Stop pauses the queue with its items retained, freeing the
    // session for a switch while the queue is still non-empty.
    stop(controller, 'session-1', 'turn-1');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });

    // Rebind discards the queue (design §4.5) and must clear the
    // persisted copy too, or a later reload would resurrect prompts
    // the user already saw discarded.
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe('session-2');
    });
    expect(recovery.readQueuedTexts('session-1')).toEqual([]);
  });

  it('queues prompts during a turn and auto-dispatches them in order after completed', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    queueAdd(controller, 'session-1', 'queued-2', 'Second queued');

    expect(queueStates(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      items: [
        { queueId: 'queued-1', text: 'First queued', attachments: [] },
        { queueId: 'queued-2', text: 'Second queued', attachments: [] },
      ],
      paused: null,
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();

    release.resolve();
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(3);
      expect(
        turnStates(messages).filter(
          ({ turnId, status }) =>
            turnId === 'queued-2' && status === 'completed',
        ),
      ).toHaveLength(1);
    });

    expect(runtime.sendTurn.mock.calls.map(([text]) => text)).toEqual([
      'Long turn',
      'First queued',
      'Second queued',
    ]);
    expect(
      turnStates(messages)
        .filter(({ status }) => status === 'submitting')
        .map(({ turnId }) => turnId),
    ).toEqual(['turn-1', 'queued-1', 'queued-2']);
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
    // The dispatch snapshot carries the not-yet-dispatched remainder.
    expect(
      snapshots(messages)
        .map(({ queue }) => queue)
        .filter((queue) => queue !== undefined),
    ).toContainEqual({
      items: [
        { queueId: 'queued-2', text: 'Second queued', attachments: [] },
      ],
      paused: null,
    });
  });

  it('closes the runtime stream before dispatching the queued head', async () => {
    const release = deferred<void>();
    let active = false;
    // Mirrors FactoryDroidRuntime's single active-turn slot: the slot
    // frees only when the generator is closed, so a dispatch fired
    // before the previous stream unwinds throws exactly like the CLI
    // runtime does.
    const runtime = createMockRuntime(async function* (text) {
      if (active) {
        throw new Error('Droid runtime already has an active turn.');
      }
      active = true;
      try {
        if (text === 'Long turn') {
          await release.promise;
        }
        yield successfulTurn();
      } finally {
        active = false;
      }
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    release.resolve();

    await vi.waitFor(() => {
      expect(
        turnStates(messages).filter(
          ({ turnId, status }) =>
            turnId === 'queued-1' && status === 'completed',
        ),
      ).toHaveLength(1);
    });
    expect(
      turnStates(messages).filter(({ status }) => status === 'failed'),
    ).toHaveLength(0);
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
  });

  it('pauses the queue on Stop and resumes dispatch only on queue.resume', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'Queued behind stop');
    stop(controller, 'session-1', 'turn-1');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });

    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [{ queueId: 'queued-1', text: 'Queued behind stop' }],
      paused: 'stopped',
    });
    // No auto-dispatch while paused.
    expect(runtime.sendTurn).toHaveBeenCalledOnce();

    controller.handleMessage({
      type: 'queue.resume',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(2);
    });
    expect(runtime.sendTurn).toHaveBeenLastCalledWith(
      'Queued behind stop',
      undefined,
    );
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
  });

  it('promotes a prompt to the head during a turn and dispatches it first', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* (text) {
      if (text === 'Long turn') {
        await release.promise;
      }
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    queueAdd(controller, 'session-1', 'queued-2', 'Second queued');
    queueAdd(controller, 'session-1', 'queued-3', 'Third queued');

    // Send now while the turn runs: a pure reorder, no interruption.
    controller.handleMessage({
      type: 'queue.promote',
      sessionId: 'session-1',
      queueId: 'queued-3',
    });
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [
        { queueId: 'queued-3' },
        { queueId: 'queued-1' },
        { queueId: 'queued-2' },
      ],
      paused: null,
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();

    // Unknown ids answer with a corrective echo and change nothing.
    controller.handleMessage({
      type: 'queue.promote',
      sessionId: 'session-1',
      queueId: 'ghost',
    });
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [
        { queueId: 'queued-3' },
        { queueId: 'queued-1' },
        { queueId: 'queued-2' },
      ],
    });

    release.resolve();
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(4);
    });
    expect(
      runtime.sendTurn.mock.calls.map(([text]) => text),
    ).toEqual([
      'Long turn',
      'Third queued',
      'First queued',
      'Second queued',
    ]);
  });

  it('resumes a paused queue when a prompt is promoted', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* (text) {
      if (text === 'Long turn') {
        yield { type: 'text-delta', text: 'working' };
        await release.promise;
        yield { ...successfulTurn(), outcome: 'interrupted' };
        return;
      }
      yield successfulTurn();
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'First queued');
    queueAdd(controller, 'session-1', 'queued-2', 'Second queued');
    stop(controller, 'session-1', 'turn-1');
    await vi.waitFor(() => {
      expect(queueStates(messages).at(-1)?.paused).toBe('stopped');
    });

    // Send now on the second prompt: explicit send intent doubles as
    // a resume, so it dispatches immediately and the rest chains.
    controller.handleMessage({
      type: 'queue.promote',
      sessionId: 'session-1',
      queueId: 'queued-2',
    });
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(3);
    });
    expect(
      runtime.sendTurn.mock.calls.map(([text]) => text),
    ).toEqual(['Long turn', 'Second queued', 'First queued']);
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
  });

  it('pauses the queue after a failed turn and clears it on queue.clear', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      throw new Error('stream failure');
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Failing turn');
    queueAdd(controller, 'session-1', 'queued-1', 'Queued behind failure');
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [{ queueId: 'queued-1' }],
      paused: 'turn-failed',
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();

    controller.handleMessage({
      type: 'queue.clear',
      sessionId: 'session-1',
    });
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();
  });

  it('enforces the queue cap, rejects duplicates, and applies edits and removals', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    for (let index = 1; index <= 11; index += 1) {
      queueAdd(controller, 'session-1', `queued-${index}`, `Prompt ${index}`);
    }
    expect(queueStates(messages).at(-1)?.items).toHaveLength(10);
    queueAdd(controller, 'session-1', 'queued-1', 'Duplicate id');
    expect(queueStates(messages).at(-1)?.items).toHaveLength(10);

    controller.handleMessage({
      type: 'queue.update',
      sessionId: 'session-1',
      queueId: 'queued-2',
      text: 'Prompt 2 (edited)',
    });
    // Unknown ids still answer with a corrective echo.
    controller.handleMessage({
      type: 'queue.update',
      sessionId: 'session-1',
      queueId: 'ghost',
      text: 'Nobody home',
    });
    for (let index = 3; index <= 10; index += 1) {
      controller.handleMessage({
        type: 'queue.remove',
        sessionId: 'session-1',
        queueId: `queued-${index}`,
      });
    }
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [
        { queueId: 'queued-1', text: 'Prompt 1' },
        { queueId: 'queued-2', text: 'Prompt 2 (edited)' },
      ],
      paused: null,
    });

    release.resolve();
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(3);
    });
    expect(runtime.sendTurn.mock.calls.map(([text]) => text)).toEqual([
      'Long turn',
      'Prompt 1',
      'Prompt 2 (edited)',
    ]);
  });

  it('consumes staged attachments at enqueue time and sends them with the dispatched turn', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    controller.handleMessage({
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'file body',
      truncated: false,
    });
    queueAdd(controller, 'session-1', 'queued-1', 'Queued with file');

    // Staging is consumed by the queued prompt, not left behind.
    expect(attachmentsMessages(messages).at(-1)?.attachments).toEqual([]);
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [
        {
          queueId: 'queued-1',
          text: 'Queued with file',
          attachments: [
            { kind: 'text', name: 'notes.txt', sizeBytes: 9 },
          ],
        },
      ],
    });

    release.resolve();
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledTimes(2);
    });
    expect(runtime.sendTurn).toHaveBeenLastCalledWith('Queued with file', [
      { kind: 'text', data: 'file body', name: 'notes.txt' },
    ]);
  });

  it('dispatches an idle-session enqueue immediately', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    queueAdd(controller, 'session-1', 'queued-1', 'Sent right away');

    await vi.waitFor(() => {
      expect(
        turnStates(messages).filter(
          ({ turnId, status }) =>
            turnId === 'queued-1' && status === 'completed',
        ),
      ).toHaveLength(1);
    });
    expect(runtime.sendTurn).toHaveBeenCalledWith(
      'Sent right away',
      undefined,
    );
    expect(queueStates(messages).at(-1)).toMatchObject({
      items: [],
      paused: null,
    });
  });

  it('parks the queue as dispatch-blocked when handleSend vetoes the dispatch', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    // A queueId equal to the running turn id survives enqueue but is
    // refused by handleSend's duplicate-turn guard at dispatch time.
    queueAdd(controller, 'session-1', 'turn-1', 'Collides at dispatch');
    release.resolve();

    await vi.waitFor(() => {
      expect(queueStates(messages).at(-1)?.paused).toBe(
        'dispatch-blocked',
      );
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'runtime.diagnostic',
        severity: 'warning',
        code: 'queue-dispatch-blocked',
      }),
    );
  });

  it('blocks edit-resend while prompts are queued', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'Still queued');
    stop(controller, 'session-1', 'turn-1');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });

    controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'Edited prompt',
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'runtime.diagnostic',
        code: 'edit-resend-blocked',
        message:
          'Clear the queued messages before editing an earlier message.',
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'turn.editResendRejected',
        messageId: 'message-1',
        reason: 'busy',
      }),
    );
    expect(runtime.rewind).toBeUndefined();
  });

  it('discards the queue with an info diagnostic when the session line changes', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long turn');
    queueAdd(controller, 'session-1', 'queued-1', 'Doomed prompt');
    queueAdd(controller, 'session-1', 'queued-2', 'Also doomed');
    stop(controller, 'session-1', 'turn-1');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });

    controller.handleMessage({ type: 'session.new' });
    await vi.waitFor(() => {
      expect(
        messages.filter(
          (message) => message.type === 'queue.state',
        ).at(-1),
      ).toMatchObject({ items: [] });
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'runtime.diagnostic',
        severity: 'info',
        code: 'queued-messages-discarded',
        message:
          '2 queued messages were discarded because the session changed.',
      }),
    );
    // Nothing was dispatched from the discarded queue.
    expect(
      runtime.sendTurn.mock.calls.some(
        ([text]) => text === 'Doomed prompt' || text === 'Also doomed',
      ),
    ).toBe(false);
  });

  it('drops queue requests for other sessions or while disconnected', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    queueAdd(controller, 'other-session', 'queued-1', 'Wrong session');

    expect(queueStates(messages)).toHaveLength(0);
    expect(runtime.sendTurn).not.toHaveBeenCalled();
  });
});
