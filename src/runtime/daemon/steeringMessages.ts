import { AddUserMessageRequestParamsSchema, type DaemonSessionController, type SessionNotificationPayloadSchema } from '@factory/droid-sdk';
import type { z } from 'zod';
import type { DaemonStreamOptions } from './api';

/** A transport ACK means queued, not consumed. Only the matching user message confirms delivery. */
export class SteeringMessages {
  private readonly pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  constructor(private readonly controller: DaemonSessionController, private readonly sessionId: string) {}

  send(messageId: string, text: string, options: Pick<DaemonStreamOptions, 'images' | 'files'>): Promise<void> {
    if (this.pending.has(messageId)) return Promise.reject(new Error('This steering message is already being submitted.'));
    const params = AddUserMessageRequestParamsSchema.parse({
      messageId, text, images: options.images, files: options.files, queuePlacement: 'end_of_turn',
    });
    return new Promise<void>((resolve, reject) => {
      this.pending.set(messageId, { resolve, reject });
      void this.controller.addUserMessage(this.sessionId, params, messageId).catch((error: unknown) => {
        const entry = this.pending.get(messageId);
        this.pending.delete(messageId);
        entry?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  observe(notification: z.infer<typeof SessionNotificationPayloadSchema>): void {
    if (notification.type === 'create_message' && notification.message.role === 'user') {
      const id = notification.message.id;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      entry?.resolve();
    } else if (notification.type === 'queued_messages_discarded') {
      if (notification.requestId === undefined) this.close('Droid discarded the pending steering messages.');
      else {
        const entry = this.pending.get(notification.requestId);
        this.pending.delete(notification.requestId);
        entry?.reject(new Error('Droid discarded this steering message. It remains in the paused queue.'));
      }
    }
  }

  close(reason: string): void {
    for (const entry of this.pending.values()) entry.reject(new Error(reason));
    this.pending.clear();
  }
}
