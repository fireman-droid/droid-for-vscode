import type { RuntimeAttachment } from '../DroidRuntime';
import { projectStreamAttachments } from './projections';
import type { FactoryDroidSession } from './sessionTypes';

export async function steerActiveSession(
  session: FactoryDroidSession,
  active: boolean,
  messageId: string,
  text: string,
  attachments?: readonly RuntimeAttachment[],
): Promise<void> {
  if (!active || !session.steer) {
    throw new Error('The active Droid session cannot accept steering right now. The message remains queued.');
  }
  await session.steer(messageId, text, projectStreamAttachments(attachments));
}
