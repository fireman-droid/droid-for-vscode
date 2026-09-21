import { randomUUID } from 'node:crypto';
import {
  convertNotificationToStreamMessage,
  SessionNotificationPayloadSchema,
  StreamStateTracker,
  type DaemonSessionController,
  type DroidStreamEvent,
  type DroidResultMessage,
} from '@factory/droid-sdk';
import { ProtocolError } from '@factory/droid-sdk/node';
import type { DaemonNotification, DaemonStreamOptions } from './api';
import { RecoveredDaemonTurn } from './recoveredTurn';

type InternalMessage = Parameters<StreamStateTracker['processMessage']>[0];
export class DaemonStreamRecoveryError extends Error {
  constructor(readonly messageId: string, readonly recovery: RecoveredDaemonTurn) {
    super('Droid session subscription was restored after transport loss.');
    this.name = 'DaemonStreamRecoveryError';
  }
}
function isStreamEvent(message: InternalMessage): message is DroidStreamEvent {
  return (
    message.type !== 'structured_output' &&
    message.type !== 'tool_use' &&
    message.type !== 'create_message'
  );
}

/** A single submission. SDK conversion and result tracking remain SDK-owned. */
export class DaemonTurnStream {
  private readonly queue: DroidStreamEvent[] = [];
  private wake: (() => void) | undefined;
  private failure: unknown;
  private failed = false;
  private done = false;
  private completed = false;
  private detached = false;
  private released = false;
  private releaseAfterCompletion = false;
  private interruptPromise: Promise<void> | undefined;
  private interrupted = false;
  private transportSuspended = false;
  private recoveredCompletion: DroidResultMessage | undefined;
  private readonly turnId = randomUUID();
  private readonly tracker: StreamStateTracker;
  private readonly donePromise: Promise<void>;
  private resolveDone!: () => void;

  constructor(
    private readonly controller: DaemonSessionController,
    private readonly sessionId: string,
    private readonly options: DaemonStreamOptions,
    private readonly onRelease: () => void,
    private readonly waitUntilReady: () => Promise<void> = async () => {},
    private readonly retainRecovery: (recovery: RecoveredDaemonTurn) => () => void = () => () => {},
  ) {
    this.tracker = new StreamStateTracker({
      sessionId,
      startedAt: Date.now(),
      hasOutputFormat: options.outputFormat !== undefined,
    });
    this.donePromise = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    controller.on('sessionNotification', this.observe);
  }

  private readonly observe = ({ sessionId, notification }: DaemonNotification): void => {
    if (sessionId !== this.sessionId) return;
    const parsed = SessionNotificationPayloadSchema.safeParse(notification);
    if (!parsed.success) return;
    const inner = parsed.data;
    if (inner.type === 'agent_turn_completed') {
      if (inner.turnId === undefined) {
        this.fail(
          new ProtocolError('Agent turn completion did not include the expected turn ID'),
        );
      } else if (inner.turnId === this.turnId) {
        this.completed = true;
        const result = this.tracker.completeTurn(inner);
        if (this.transportSuspended) {
          this.recoveredCompletion = { ...result, tokenUsage: inner.tokenUsage ?? null };
          return;
        }
        this.queue.push(result);
        this.finish();
        if (this.releaseAfterCompletion) this.release();
      }
      return;
    }
    if (this.done || this.transportSuspended) return;
    const converted = convertNotificationToStreamMessage(inner);
    for (const input of converted === null
      ? []
      : Array.isArray(converted)
        ? converted
        : [converted]) {
      const { message, additional } = this.tracker.processMessage(input);
      for (const event of message === null ? additional : [message, ...additional]) {
        if (!isStreamEvent(event)) continue;
        if (
          this.options.includePartialMessages ||
          [
            'assistant',
            'user',
            'tool_call',
            'tool_result',
            'hook',
            'error',
            'result',
          ].includes(event.type)
        ) {
          this.queue.push(event);
        }
      }
    }
    this.wake?.();
  };

  suspendTransport(): void { this.transportSuspended = true; }

  restoreTransport(messages?: readonly { readonly id: string }[]): void {
    if (!this.transportSuspended || this.done) return;
    if (messages !== undefined && !messages.some((message) => message.id === this.turnId)) {
      this.failTransport(new Error('The session was restored, but delivery of this message could not be confirmed.'));
      return;
    }
    this.detached = true;
    let release = () => {};
    const recovery = new RecoveredDaemonTurn(this.controller, this.sessionId, this.turnId,
      this.tracker, this.recoveredCompletion, () => release());
    release = this.retainRecovery(recovery);
    this.fail(new DaemonStreamRecoveryError(this.turnId, recovery));
  }

  failTransport(error: Error): void {
    // Transport loss is not a request to cancel work on the daemon.
    this.detached = true;
    this.fail(error);
  }

  readonly fail = (error: unknown): void => {
    this.failed = true;
    this.failure = error;
    this.finish();
  };

  private finish(): void {
    this.done = true;
    this.resolveDone();
    this.wake?.();
  }

  detach(): void {
    this.detached = true;
    this.finish();
    this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.controller.off('sessionNotification', this.observe);
    this.onRelease();
  }

  interrupt(): Promise<void> {
    if (this.interruptPromise) return this.interruptPromise;
    const pending = this.waitUntilReady().then(async () => {
      if (!this.completed) await this.controller.interruptSession(this.sessionId);
      this.interrupted = true;
      this.finish();
    });
    this.interruptPromise = pending;
    void pending.catch(() => {
      if (this.interruptPromise === pending) this.interruptPromise = undefined;
    });
    return pending;
  }

  async *messages(prompt: string): AsyncGenerator<DroidStreamEvent> {
    const signal = this.options.abortSignal;
    const abort = (): void => {
      this.finish();
      // The awaited cleanup below reports interrupt failure and retains the slot.
      void this.interrupt().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      await Promise.race([
        this.controller.addUserMessage(this.sessionId, {
          messageId: this.turnId,
          text: prompt,
          images: this.options.images,
          files: this.options.files as Parameters<
            DaemonSessionController['addUserMessage']
          >[1]['files'],
          outputFormat: this.options.outputFormat,
          userMessageSource: 'api' as Parameters<
            DaemonSessionController['addUserMessage']
          >[1]['userMessageSource'],
        }).catch(async (error: unknown) => {
          if (!this.transportSuspended) throw error;
          await this.waitUntilReady();
          this.restoreTransport();
        }),
        this.donePromise,
      ]);
      while (true) {
        signal?.throwIfAborted();
        if (this.failed) throw this.failure;
        const event = this.queue.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }
        if (this.done) break;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', abort);
      let safeToRelease = this.completed || this.detached || this.interrupted;
      try {
        if (!safeToRelease) {
          await this.interrupt();
          safeToRelease = true;
        }
      } finally {
        if (safeToRelease || this.completed) this.release();
        else this.releaseAfterCompletion = true;
      }
    }
  }
}
