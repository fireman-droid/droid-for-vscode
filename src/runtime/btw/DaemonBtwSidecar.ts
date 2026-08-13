import {
  ToolConfirmationOutcome,
  type ConnectedDroid,
} from '@factory/droid-sdk';

import {
  BTW_FORK_TAG,
  BTW_FORK_TITLE,
  BTW_PERMISSION_GUIDANCE,
  type BtwAnswerEvent,
  type BtwSidecar,
} from './BtwSidecar';

/**
 * Daemon-mode counterpart of `createBtwSidecar` (side-question-design
 * §5.2 daemon increment). Rides the window's shared daemon connection:
 * `daemon.fork_session` with the `btw-fork` tag gets full server-side
 * btw semantics — fork point `lastCompletedTurn`, session file under
 * `sessions/btw/`, no cloud session — and resuming the fork over the
 * daemon does NOT promote it out of the btw directory
 * (probe-verified 2026-08-12, `artifacts/probe-btw-daemon.mjs`:
 * `resumePromotesFork: false`, `listLeaksFork: false`).
 *
 * Lifecycle mirrors the process sidecar: one sidecar per card opening;
 * `dispose()` ends the fork session in the daemon
 * (`daemon.close_session`), leaving the fork jsonl in `sessions/btw/`.
 */

/**
 * One event from the fork's answer stream. Optional-unknown fields so
 * any SDK stream event shape is structurally assignable; projection
 * validates.
 */
export interface DaemonBtwStreamEvent {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly subtype?: unknown;
}

/** Attached fork surface consumed by the sidecar. */
export interface DaemonBtwFork {
  /** Streams one turn; ends after the terminal result event. */
  stream(text: string): AsyncIterable<DaemonBtwStreamEvent>;
  /** Interrupts the streaming turn (side-pane Stop). */
  interrupt(): Promise<void>;
  /** Ends the fork session in the daemon, then detaches. */
  close(): Promise<void>;
}

/**
 * Minimal daemon surface the sidecar needs. The default adapter maps
 * a `ConnectedDroid` onto it; tests inject fakes via `createClient`.
 */
export interface DaemonBtwClient {
  fork(
    mainSessionId: string,
    params: {
      title: string;
      tags: readonly { readonly name: string }[];
    },
  ): Promise<unknown>;
  /**
   * Attaches to the fork with a deny-all permission handler;
   * `onPermissionDenied` fires whenever a permission request was
   * cancelled during a turn.
   */
  attach(
    forkSessionId: string,
    onPermissionDenied: () => void,
  ): Promise<DaemonBtwFork>;
}

export type DaemonBtwClientFactory = () => Promise<DaemonBtwClient>;

export async function createDaemonBtwSidecar(options: {
  readonly mainSessionId: string;
  readonly getDroid?: () => Promise<ConnectedDroid>;
  readonly createClient?: DaemonBtwClientFactory;
}): Promise<BtwSidecar> {
  const createClient =
    options.createClient ??
    (() => {
      const getDroid = options.getDroid;
      if (getDroid === undefined) {
        throw new Error(
          'createDaemonBtwSidecar needs getDroid or createClient.',
        );
      }
      return createConnectedDroidBtwClient(getDroid);
    });
  const client = await createClient();
  const forkResponse = await client.fork(options.mainSessionId, {
    title: BTW_FORK_TITLE,
    tags: [{ name: BTW_FORK_TAG }],
  });
  const forkSessionId = readForkSessionId(forkResponse);
  if (forkSessionId === null) {
    throw new Error('Droid returned an invalid fork response.');
  }
  const denied = { value: false };
  const fork = await client.attach(forkSessionId, () => {
    denied.value = true;
  });
  return new DaemonBtwForkSidecar(fork, forkSessionId, denied);
}

async function createConnectedDroidBtwClient(
  getDroid: () => Promise<ConnectedDroid>,
): Promise<DaemonBtwClient> {
  const droid = await getDroid();
  return {
    fork: (mainSessionId, params) =>
      droid.sessions.fork(mainSessionId, {
        title: params.title,
        tags: params.tags.map((tag) => ({ name: tag.name })),
      }),
    attach: async (forkSessionId, onPermissionDenied) => {
      // The side card renders no permission or AskUser UI (that is
      // the main chat's interaction surface): permission requests are
      // denied and the entry errors with guidance instead.
      const session = await droid.sessions.resume(forkSessionId, {
        permissionHandler: () => {
          onPermissionDenied();
          return ToolConfirmationOutcome.Cancel;
        },
        askUserHandler: () => ({ cancelled: true, answers: [] }),
      });
      return {
        stream: (text) =>
          session.stream(text, { includePartialMessages: true }),
        interrupt: () => session.interrupt(),
        close: () => session.close(),
      };
    },
  };
}

function readForkSessionId(response: unknown): string | null {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('newSessionId' in response)
  ) {
    return null;
  }
  const id = (response as { newSessionId: unknown }).newSessionId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

class DaemonBtwForkSidecar implements BtwSidecar {
  private disposed = false;

  private asking = false;

  constructor(
    private readonly fork: DaemonBtwFork,
    readonly forkSessionId: string,
    /** Set by the attach-time deny-all handler during a turn. */
    private readonly denied: { value: boolean },
  ) {}

  async *ask(text: string): AsyncGenerator<BtwAnswerEvent, void> {
    if (this.disposed) {
      throw new Error('The side chat sidecar is disposed.');
    }
    if (this.asking) {
      throw new Error('A side question is already streaming.');
    }
    this.asking = true;
    this.denied.value = false;
    try {
      let terminal: BtwAnswerEvent | null = null;
      try {
        for await (const raw of this.fork.stream(text)) {
          if (this.disposed) {
            return;
          }
          const event = this.projectStreamEvent(raw);
          if (event === null) {
            continue;
          }
          if (event.kind === 'delta') {
            yield event;
            continue;
          }
          terminal = event;
          break;
        }
      } catch {
        if (this.disposed) {
          return;
        }
        yield { kind: 'error', message: 'Side chat connection failed.' };
        return;
      }
      if (this.disposed) {
        return;
      }
      // A stream that ends without a result event still terminates
      // the entry; the deny check keeps the guidance message first.
      yield terminal ??
        (this.denied.value
          ? { kind: 'error', message: BTW_PERMISSION_GUIDANCE }
          : { kind: 'done' });
    } finally {
      this.asking = false;
    }
  }

  async interrupt(): Promise<void> {
    if (this.disposed || !this.asking) {
      return;
    }
    // The interrupted turn still terminates its own stream (result
    // event), which settles the in-flight ask.
    await this.fork.interrupt().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // daemon.close_session: CLI teardownFork semantics — the fork
    // jsonl stays in sessions/btw/ (probe finding). Best-effort.
    await this.fork.close().catch(() => undefined);
  }

  /** Maps one raw stream event onto an answer event. */
  private projectStreamEvent(
    raw: DaemonBtwStreamEvent,
  ): BtwAnswerEvent | null {
    switch (raw.type) {
      case 'assistant_text_delta':
        return typeof raw.text === 'string' && raw.text.length > 0
          ? { kind: 'delta', text: raw.text }
          : null;
      case 'result':
        if (this.denied.value) {
          return { kind: 'error', message: BTW_PERMISSION_GUIDANCE };
        }
        return raw.subtype === 'success'
          ? { kind: 'done' }
          : {
              kind: 'error',
              message:
                'Droid reported an error answering the side question.',
            };
      case 'error':
        return {
          kind: 'error',
          message: 'Droid reported an error answering the side question.',
        };
      default:
        return null;
    }
  }
}
