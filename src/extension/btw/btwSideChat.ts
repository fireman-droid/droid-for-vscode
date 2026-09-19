import type { BtwAnswerEvent } from '../../runtime/btw/BtwSidecar';
import {
  EMPTY_SESSION_BTW_STATE,
  type SessionBtwState,
} from '../../shared/protocol/btwProtocol';
import {
  appendBtwAnswerDelta,
  appendBtwQuestion,
  completeBtwEntry,
  failBtwEntry,
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
  ask(text: string): AsyncGenerator<BtwAnswerEvent, void>;
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
  async handleAsk(cwd: string, mainSessionId: string, text: string): Promise<void> {
    if (this.asking) {
      if (this.boundSessionId === mainSessionId) {
        this.setState(setBtwPendingQuestion(this.state, text), true);
      }
      return;
    }
    this.bindSession(mainSessionId);
    const generation = this.generation;
    this.asking = true;
    try {
      const sidecar = await this.ensureSidecar(cwd, mainSessionId, generation);
      if (sidecar === null) {
        return;
      }
      let question = text;
      while (this.generation === generation) {
        const entryId = `btw-${(this.entryCounter += 1)}`;
        this.setState(appendBtwQuestion(this.state, entryId, question), true);
        let settled = false;
        try {
          for await (const event of sidecar.ask(question)) {
            if (this.generation !== generation) {
              return;
            }
            if (event.kind === 'delta') {
              this.setState(appendBtwAnswerDelta(this.state, entryId, event.text), false);
              continue;
            }
            if (event.kind === 'done' || this.stopping) {
              // A user-initiated Stop keeps the partial answer as a
              // settled entry instead of styling it as a failure.
              this.setState(completeBtwEntry(this.state, entryId), true);
            } else {
              this.setState(failBtwEntry(this.state, entryId, event.message), true);
            }
            settled = true;
            break;
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
        const pendingQuestion = this.state.pendingQuestion;
        if (pendingQuestion === null) {
          return;
        }
        // Clear without an intermediate emit: appending the next
        // streaming entry publishes the consumed slot atomically.
        this.state = setBtwPendingQuestion(this.state, null);
        question = pendingQuestion;
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
      sidecar?.interrupt === undefined
    ) {
      return;
    }
    this.stopping = true;
    if (this.state.pendingQuestion !== null) {
      this.setState(setBtwPendingQuestion(this.state, null), true);
    }
    void sidecar.interrupt().catch(() => undefined);
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
