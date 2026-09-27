import { DroidClient, ProcessTransport, ToolConfirmationOutcome, type Base64ImageSource } from '@factory/droid-sdk/node';
import type { BtwEntryProgress } from '../../shared/protocol/btwProtocol';

/**
 * Hidden-fork sidecar behind the `/btw` Side Chat card
 * (side-question-design.md §5.2).
 *
 * Runs one public `DroidClient` over its own `ProcessTransport` — the
 * same channel `FactoryCommandCatalog` and the session history loader
 * use — so the main session's runtime binding is never touched. The
 * server recognizes the `btw-fork` tag and applies full CLI btw
 * semantics: fork point `lastCompletedTurn`, session file under
 * `sessions/btw/`, no cloud session (probe-verified 2026-08-12,
 * `artifacts/probe-btw-sidecar.mjs`).
 *
 * Lifecycle: one sidecar per card opening; `dispose()` closes the
 * fork session, which terminates the subprocess (probe finding), so
 * a disposed sidecar is never reused.
 */

export const BTW_FORK_TAG = 'btw-fork';
export const BTW_FORK_TITLE = 'Droid side chat';

/** Quiet guidance when a side question hits a permission request. */
export const BTW_PERMISSION_GUIDANCE =
  'This question needs tool permissions — ask it in the main chat.';

export type BtwAnswerEvent =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'progress'; readonly progress: BtwEntryProgress }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };

export interface BtwPromptOptions {
  readonly images?: Base64ImageSource[];
  readonly modelId?: string;
}

/**
 * Minimal public-API surface the sidecar needs. Mirrors
 * `FactoryCommandsClient` with the streaming additions; tests inject
 * fakes through `createClient`.
 */
export interface BtwSidecarClient {
  loadSession(params: { sessionId: string }): Promise<unknown>;
  forkSession(params: {
    title?: string;
    tags?: { name: string }[];
  }): Promise<unknown>;
  /** Applies the fork-only model choice before submitting the message. */
  addUserMessage(params: { text: string; signal?: AbortSignal } & BtwPromptOptions): Promise<unknown>;
  /** Interrupts the fork's streaming turn (side-pane Stop). */
  interruptSession?(params?: object): Promise<unknown>;
  onNotification(
    callback: (notification: Record<string, unknown>) => void,
  ): () => void;
  onError(callback: (error: Error) => void): () => void;
  setPermissionHandler(
    handler: () => { outcome: 'cancel' },
  ): void;
  closeSession(): Promise<unknown>;
  close(): Promise<void>;
}

export type BtwSidecarClientFactory = (
  cwd: string,
) => Promise<BtwSidecarClient>;

export interface BtwSidecar {
  /** Fork session id, for diagnostics only (never listed in UIs). */
  readonly forkSessionId: string;
  /**
   * Streams one side question. Yields answer deltas, then exactly one
   * terminal `done`/`error` event. One question at a time.
   */
  ask(text: string, options?: BtwPromptOptions): AsyncGenerator<BtwAnswerEvent, void>;
  /**
   * Optional: interrupts the streaming answer (side-pane Stop). The
   * in-flight ask still terminates through its own event stream.
   */
  interrupt?(): Promise<void>;
  /** Closes the fork and the transport; idempotent, swallows errors. */
  dispose(): Promise<void>;
}

export async function createBtwSidecar(options: {
  readonly cwd: string;
  readonly mainSessionId: string;
  readonly createClient?: BtwSidecarClientFactory;
}): Promise<BtwSidecar> {
  const createClient = options.createClient ?? createLocalBtwClient;
  const client = await createClient(options.cwd);
  try {
    await client.loadSession({ sessionId: options.mainSessionId });
    const forkResponse = await client.forkSession({
      title: BTW_FORK_TITLE,
      tags: [{ name: BTW_FORK_TAG }],
    });
    const forkSessionId = readForkSessionId(forkResponse);
    if (forkSessionId === null) {
      throw new Error('Droid returned an invalid fork response.');
    }
    await client.loadSession({ sessionId: forkSessionId });
    return new BtwForkSidecar(client, forkSessionId);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function createLocalBtwClient(
  cwd: string,
): Promise<BtwSidecarClient> {
  const transport = new ProcessTransport({ cwd });
  try {
    await transport.connect();
    const client = new DroidClient({ transport });
    return {
      loadSession: (params) => client.loadSession(params),
      forkSession: (params) => client.forkSession(params),
      addUserMessage: async ({ modelId, signal, ...params }) => {
        if (modelId !== undefined) await client.updateSessionSettings({ modelId, specModeModelId: null });
        signal?.throwIfAborted();
        return client.addUserMessage(params);
      },
      interruptSession: (params) => client.interruptSession(params),
      onNotification: (callback) => client.onNotification(callback),
      onError: (callback) => client.onError(callback),
      setPermissionHandler: (handler) => client.setPermissionHandler(() => {
        handler();
        return ToolConfirmationOutcome.Cancel;
      }),
      closeSession: () => client.closeSession(),
      close: () => client.close(),
    };
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function readForkSessionId(response: unknown): string | null {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('result' in response)
  ) {
    return null;
  }
  const result = (response as { result: unknown }).result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('newSessionId' in result)
  ) {
    return null;
  }
  const id = (result as { newSessionId: unknown }).newSessionId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

class BtwForkSidecar implements BtwSidecar {
  private disposed = false;

  private asking = false;
  private abortAsk: AbortController | null = null;

  /** Wakes the in-flight ask loop so disposal can end it promptly. */
  private interruptAsk: (() => void) | null = null;

  /** Set when the deny-all permission handler fires during a turn. */
  private permissionDenied = false;

  constructor(
    private readonly client: BtwSidecarClient,
    readonly forkSessionId: string,
  ) {
    // The side card renders no permission UI (that is the main
    // chat's interaction surface), so every permission request is
    // denied and the entry errors with guidance instead.
    client.setPermissionHandler(() => {
      this.permissionDenied = true;
      return { outcome: 'cancel' };
    });
  }

  async *ask(text: string, options: BtwPromptOptions = {}): AsyncGenerator<BtwAnswerEvent, void> {
    if (this.disposed) {
      throw new Error('The side chat sidecar is disposed.');
    }
    if (this.asking) {
      throw new Error('A side question is already streaming.');
    }
    this.asking = true;
    this.abortAsk = new AbortController();
    this.permissionDenied = false;

    const queue: BtwAnswerEvent[] = [];
    let wake: (() => void) | null = null;
    this.interruptAsk = () => {
      wake?.();
      wake = null;
    };
    const push = (event: BtwAnswerEvent): void => {
      queue.push(event);
      wake?.();
      wake = null;
    };
    const unsubscribeNotifications = this.client.onNotification(
      (raw) => {
        const event = this.projectNotification(raw);
        if (event !== null) {
          push(event);
        }
      },
    );
    const unsubscribeErrors = this.client.onError(() => {
      push({ kind: 'error', message: 'Side chat connection failed.' });
    });

    try {
      await this.client.addUserMessage({ text, ...options, signal: this.abortAsk.signal });
      while (!this.disposed) {
        const event = queue.shift();
        if (event === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield event;
        if (event.kind === 'done' || event.kind === 'error') {
          return;
        }
      }
    } finally {
      unsubscribeNotifications();
      unsubscribeErrors();
      wake = null;
      this.interruptAsk = null;
      this.asking = false;
      this.abortAsk = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.disposed || !this.asking) {
      return;
    }
    this.abortAsk?.abort();
    // The interrupted turn still ends through the notification
    // stream (agent_turn_completed), which terminates the ask loop.
    await this.client
      .interruptSession?.({})
      .catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abortAsk?.abort();
    this.interruptAsk?.();
    // closeSession terminates the sidecar subprocess (probe finding);
    // both steps are best-effort on an already-dying process.
    await this.client.closeSession().catch(() => undefined);
    await this.client.close().catch(() => undefined);
  }

  /** Maps one raw session notification onto an answer event. */
  private projectNotification(
    raw: Record<string, unknown>,
  ): BtwAnswerEvent | null {
    const params = isRecord(raw.params) ? raw.params : raw;
    if (
      typeof params.sessionId === 'string' &&
      params.sessionId !== this.forkSessionId
    ) {
      return null;
    }
    const notification = isRecord(params.notification)
      ? params.notification
      : params;
    switch (notification.type) {
      case 'thinking_text_delta':
        return { kind: 'progress', progress: 'thinking' };
      case 'tool_call':
      case 'tool_progress_update':
        return { kind: 'progress', progress: 'tool' };
      case 'assistant_text_delta':
        return typeof notification.textDelta === 'string' &&
          notification.textDelta.length > 0
          ? { kind: 'delta', text: notification.textDelta }
          : null;
      case 'agent_turn_completed':
        return this.permissionDenied
          ? { kind: 'error', message: BTW_PERMISSION_GUIDANCE }
          : { kind: 'done' };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
