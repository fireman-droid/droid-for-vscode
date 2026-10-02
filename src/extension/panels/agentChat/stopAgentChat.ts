import type { ChatController } from '../../chat/ChatController';
import { isTurnActive } from '../../chat/internals';

/** Stops the existing child session; never starts a model turn or opens a panel. */
export async function stopAgentChat(controller: ChatController, sessionId: string): Promise<'stopped' | 'idle'> {
  await controller.replayTo(() => undefined);
  const runtime = controller.sessionState.runtime;
  if (!runtime || controller.sessionState.sessionId !== sessionId ||
      controller.sessionState.connection.status !== 'connected' || !runtime.readSessionWorkingState) {
    throw new Error('The agent conversation could not be connected. Its work has not been stopped.');
  }
  const current = () => !controller.sessionState.disposed &&
    controller.sessionState.runtime === runtime && controller.sessionState.sessionId === sessionId;
  const before = await runtime.readSessionWorkingState();
  if (!current()) throw new Error('The agent conversation changed before it could be stopped.');
  if (before === 'idle') return 'idle';
  if (before !== 'running' && before !== 'waiting-for-user') {
    throw new Error('The agent working state is unavailable. Its work has not been stopped.');
  }
  const turn = controller.turnState.turn;
  if (isTurnActive(turn) && turn !== null) controller.effects.handleStop(sessionId, turn.turnId);
  else if (runtime.interruptSession) await runtime.interruptSession();
  else throw new Error('This agent runtime does not support stopping its session.');

  const deadline = Date.now() + 30_000;
  while (current() && Date.now() < deadline) {
    const state = await runtime.readSessionWorkingState();
    if (!current()) break;
    if (turn && controller.turnState.turn?.turnId !== turn.turnId) {
      throw new Error('The agent started another reply while Stop was being confirmed. Review its conversation before stopping it again.');
    }
    if (state === 'idle') return 'stopped';
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Droid has not confirmed that the agent stopped. Open its conversation to check its current state.');
}
