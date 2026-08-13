import type { BtwAnswerEvent } from '../runtime/btw/BtwSidecar';
import {
  EMPTY_SESSION_BTW_STATE,
  type SessionBtwState,
} from '../shared/btwProtocol';
import {
  appendBtwAnswerDelta,
  appendBtwQuestion,
  completeBtwEntry,
  failBtwEntry,
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
const BTW_ANSWER_FAILED_MESSAGE =
  'Droid could not answer this side question.';
/**
 * Delta coalescing cadence: the card is a whole-state projection, so
 * per-token emits would resend the growing answer on every delta.
 */
const BTW_EMIT_INTERVAL_MS = 50;

export class BtwSideChat {
  private state: SessionBtwState = EMPTY_SESSION_BTW_STATE;
  private sidecar: BtwSideChatSidecar | null = null;
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
    private readonly emit: (
      sessionId: string,
      btw: SessionBtwState,
    ) => void,
  ) {}

  /**
   * Streams one side question. Serialized by the card UI (its input
   * disables while streaming); overlapping asks are dropped.
   */
  async handleAsk(
    cwd: string,
    mainSessionId: string,
    text: string,
  ): Promise<void> {
    if (this.asking) {
      return;
    }
    if (this.boundSessionId !== mainSessionId) {
      // First ask of a card, or a stale card from a previous session
      // raced the switch: rebind onto a fresh fork.
      this.teardown();
      this.boundSessionId = mainSessionId;
    }
    const generation = this.generation;
    this.asking = true;
    try {
      if (this.sidecar === null) {
        this.setState(setBtwStatus(this.state, 'forking'), true);
        let sidecar: BtwSideChatSidecar;
        try {
          sidecar = await this.createSidecar(cwd, mainSessionId);
        } catch {
          if (this.generation === generation) {
            this.setState(
              setBtwStatus(this.state, 'error', BTW_START_FAILED_MESSAGE),
              true,
            );
          }
          return;
        }
        if (this.generation !== generation) {
          void sidecar.dispose();
          return;
        }
        this.sidecar = sidecar;
        this.setState(setBtwStatus(this.state, 'ready'), true);
      }
      const entryId = `btw-${(this.entryCounter += 1)}`;
      this.setState(appendBtwQuestion(this.state, entryId, text), true);
      try {
        for await (const event of this.sidecar.ask(text)) {
          if (this.generation !== generation) {
            return;
          }
          if (event.kind === 'delta') {
            this.setState(
              appendBtwAnswerDelta(this.state, entryId, event.text),
              false,
            );
          } else if (event.kind === 'done' || this.stopping) {
            // A user-initiated Stop keeps the partial answer as a
            // settled entry instead of styling it as a failure.
            this.setState(completeBtwEntry(this.state, entryId), true);
          } else {
            this.setState(
              failBtwEntry(this.state, entryId, event.message),
              true,
            );
          }
        }
      } catch {
        if (this.generation === generation) {
          this.setState(
            failBtwEntry(this.state, entryId, BTW_ANSWER_FAILED_MESSAGE),
            true,
          );
        }
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
    void sidecar.interrupt().catch(() => undefined);
  }

  /** Card closed in the webview: discard the fork and every entry. */
  handleDismiss(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      this.teardown();
    }
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

  /**
   * Applies one card transition. Terminal transitions flush
   * immediately; streaming deltas coalesce on a short timer so the
   * growing answer is not resent per token.
   */
  private setState(next: SessionBtwState, urgent: boolean): void {
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
