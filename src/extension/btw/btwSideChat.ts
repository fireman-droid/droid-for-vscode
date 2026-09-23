import type { BtwAnswerEvent, BtwPromptOptions } from '../../runtime/btw/BtwSidecar';
import {
  EMPTY_SESSION_BTW_STATE,
  type SessionBtwState,
  type BtwAskOptions,
} from '../../shared/protocol/btwProtocol';
import {
  appendBtwAnswerDelta,
  appendBtwQuestion,
  completeBtwEntry,
  failBtwEntry,
  setBtwEntryProgress,
  setBtwPendingQuestion,
  setBtwStatus,
} from './btwCardState';

/**
 * Host-side driver of the `/btw` side-chat card
 * (side-question-design.md §5.2–5.3).
 *
 * Owns the hidden-fork sidecar lifecycle and the bounded card
 * projection; `ChatController` only routes `btw.ask`/`btw.dismiss`
 * into it, mirrors emitted card states onto the Bridge, and calls
 * `reset()` whenever the bound session changes (discard-on-close).
 * The fork session id never leaves this module, so no session list
 * or transcript can surface it.
 */

/** Sidecar surface consumed here; `BtwSidecar` satisfies it. */
export interface BtwSideChatSidecar {
  ask(text: string, options?: BtwPromptOptions): AsyncGenerator<BtwAnswerEvent, void>;
  /** Optional: interrupts the streaming answer (side-pane Stop). */
  interrupt?(): Promise<void>;
  dispose(): Promise<void>;
}

export type BtwSidecarFactory = (
  cwd: string,
  mainSessionId: string,
) => Promise<BtwSideChatSidecar>;

const BTW_START_FAILED_MESSAGE =
  'The side chat could not start. Retry, or ask in the main chat.';
const BTW_ANSWER_FAILED_MESSAGE = 'Droid could not answer this side question.';
/**
 * Delta coalescing cadence: the card is a whole-state projection, so
 * per-token emits would resend the growing answer on every delta.
 */
const BTW_EMIT_INTERVAL_MS = 50;

export class BtwSideChat {
  private state: SessionBtwState = EMPTY_SESSION_BTW_STATE;
  private sidecar: BtwSideChatSidecar | null = null;
  private sidecarPreparation: Promise<BtwSideChatSidecar | null> | null = null;
  /** Bound main session; asks for other sessions are stale. */
  private boundSessionId: string | null = null;
  /** Bumped by every teardown; async continuations check it. */
  private generation = 0;
  private asking = false;
  private pendingRequest: { text: string; options: BtwAskOptions } | null = null;
  /** A user-initiated Stop is in flight for the current entry. */
  private stopping = false;
  private entryCounter = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly createSidecar: BtwSidecarFactory,
    private readonly emit: (sessionId: string, btw: SessionBtwState) => void,
  ) {}

  /** Prepares the hidden fork as soon as the side pane opens. */
  async handlePrepare(cwd: string, mainSessionId: string): Promise<void> {
    this.bindSession(mainSessionId);
    await this.ensureSidecar(cwd, mainSessionId, this.generation);
  }

  /**
   * Streams one side question. While it runs, the latest overlapping
   * ask occupies the card's one-item pending slot and is dispatched
   * automatically after the current answer settles.
   */
  async handleAsk(cwd: string, mainSessionId: string, text: string, options: BtwAskOptions = {}): Promise<void> {
    if (this.asking) {
      if (this.boundSessionId === mainSessionId) {
        this.pendingRequest = { text, options };
        this.setState(setBtwPendingQuestion(this.state, text, options), true);
      }
      return;
    }
    this.bindSession(mainSessionId);
    const generation = this.generation;
    this.asking = true;
    try {
      let question = text;
      let questionOptions = options;
      let entryId = `btw-${(this.entryCounter += 1)}`;
      this.setState(appendBtwQuestion(this.state, entryId, question, questionOptions), true);
      const sidecar = await this.ensureSidecar(cwd, mainSessionId, generation);
      if (this.generation !== generation) {
        return;
      }
      if (sidecar === null) {
        this.pendingRequest = null;
        this.setState(
          this.stopping
            ? completeBtwEntry(this.state, entryId)
            : failBtwEntry(this.state, entryId, BTW_START_FAILED_MESSAGE),
          true,
        );
        return;
      }
      while (this.generation === generation) {
        let settled = false;
        try {
          // Stop can arrive while the fork is preparing, before any
          // question has been dispatched to the sidecar.
          if (!this.stopping) {
            for await (const event of sidecar.ask(question, {
              ...(questionOptions.modelId === undefined ? {} : { modelId: questionOptions.modelId }),
              ...(questionOptions.images?.length ? { images: questionOptions.images.map((image) => ({
                type: 'base64' as const, mediaType: image.mediaType, data: image.dataBase64,
              })) } : {}),
            })) {
              if (this.generation !== generation) {
                return;
              }
              if (event.kind === 'delta') {
                this.setState(appendBtwAnswerDelta(this.state, entryId, event.text), false);
                continue;
              }
              if (event.kind === 'progress') {
                this.setState(setBtwEntryProgress(this.state, entryId, event.progress), false);
                continue;
              }
              if (event.kind === 'done' || this.stopping) {
                // Stop preserves whatever partial answer arrived.
                this.setState(completeBtwEntry(this.state, entryId), true);
              } else {
                this.setState(failBtwEntry(this.state, entryId, event.message), true);
              }
              settled = true;
              break;
            }
          }
          if (!settled && this.generation === generation) {
            this.setState(completeBtwEntry(this.state, entryId), true);
          }
        } catch {
          if (this.generation === generation) {
            this.setState(
              this.stopping
                ? completeBtwEntry(this.state, entryId)
                : failBtwEntry(this.state, entryId, BTW_ANSWER_FAILED_MESSAGE),
              true,
            );
          }
        }
        if (this.generation !== generation) {
          return;
        }
        this.stopping = false;
        const pending = this.pendingRequest;
        if (pending === null) {
          return;
        }
        // Clear without an intermediate emit: appending the next
        // streaming entry publishes the consumed slot atomically.
        this.state = setBtwPendingQuestion(this.state, null);
        this.pendingRequest = null;
        question = pending.text;
        questionOptions = pending.options;
        entryId = `btw-${(this.entryCounter += 1)}`;
        this.setState(appendBtwQuestion(this.state, entryId, question, questionOptions), true);
      }
    } finally {
      if (this.generation === generation) {
        this.asking = false;
        this.stopping = false;
      }
    }
  }

  /**
   * Stops the streaming answer (side-pane Stop). The interrupted turn
   * still terminates through its own event stream, which settles the
   * entry with whatever partial answer arrived.
   */
  handleStop(sessionId: string): void {
    const sidecar = this.sidecar;
    if (
      this.boundSessionId !== sessionId ||
      !this.asking ||
      this.stopping ||
      (sidecar !== null && sidecar.interrupt === undefined)
    ) {
      return;
    }
    this.stopping = true;
    this.pendingRequest = null;
    let state = setBtwPendingQuestion(this.state, null);
    if (sidecar === null) {
      const preparing = state.entries.find((entry) => entry.state === 'streaming');
      if (preparing !== undefined) {
        state = completeBtwEntry(state, preparing.id);
      }
    }
    this.setState(state, true);
    void sidecar?.interrupt?.().catch(() => undefined);
  }

  /** Card closed in the webview: discard the fork and every entry. */
  handleDismiss(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      this.teardown();
    }
  }

  isBusy(): boolean {
    return this.asking || this.stopping || this.sidecarPreparation !== null;
  }

  /** Session binding changed or the host is going away. */
  reset(): void {
    this.teardown();
  }

  private teardown(): void {
    this.generation += 1;
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    const sidecar = this.sidecar;
    this.sidecar = null;
    this.boundSessionId = null;
    this.state = EMPTY_SESSION_BTW_STATE;
    this.asking = false;
    this.pendingRequest = null;
    this.stopping = false;
    if (sidecar !== null) {
      // Best-effort: the fork and its subprocess die with the close.
      void sidecar.dispose().catch(() => undefined);
    }
  }

  private bindSession(mainSessionId: string): void {
    if (this.boundSessionId !== mainSessionId) {
      this.teardown();
      this.boundSessionId = mainSessionId;
    }
  }

  private async ensureSidecar(
    cwd: string,
    mainSessionId: string,
    generation: number,
  ): Promise<BtwSideChatSidecar | null> {
    if (this.sidecar !== null) {
      return this.sidecar;
    }
    if (this.sidecarPreparation !== null) {
      const prepared = await this.sidecarPreparation;
      if (prepared !== null || this.generation !== generation) {
        return prepared;
      }
      return this.ensureSidecar(cwd, mainSessionId, generation);
    }
    this.setState(setBtwStatus(this.state, 'forking'), true);
    const preparation = (async (): Promise<BtwSideChatSidecar | null> => {
      let sidecar: BtwSideChatSidecar;
      try {
        sidecar = await this.createSidecar(cwd, mainSessionId);
      } catch {
        if (this.generation === generation) {
          this.setState(
            setBtwStatus(
              setBtwPendingQuestion(this.state, null),
              'error',
              BTW_START_FAILED_MESSAGE,
            ),
            true,
          );
        }
        return null;
      }
      if (this.generation !== generation) {
        void sidecar.dispose();
        return null;
      }
      this.sidecar = sidecar;
      this.setState(setBtwStatus(this.state, 'ready'), true);
      return sidecar;
    })();
    this.sidecarPreparation = preparation;
    try {
      return await preparation;
    } finally {
      if (this.sidecarPreparation === preparation) {
        this.sidecarPreparation = null;
      }
    }
  }

  /**
   * Applies one card transition. Terminal transitions flush
   * immediately; streaming deltas coalesce on a short timer so the
   * growing answer is not resent per token.
   */
  private setState(next: SessionBtwState, urgent: boolean): void {
    if (next === this.state) {
      return;
    }
    this.state = next;
    if (urgent) {
      this.flush();
      return;
    }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null;
      this.flush();
    }, BTW_EMIT_INTERVAL_MS);
  }

  private flush(): void {
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.boundSessionId !== null) {
      this.emit(this.boundSessionId, this.state);
    }
  }
}
