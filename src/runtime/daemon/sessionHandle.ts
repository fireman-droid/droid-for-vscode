import {
  ConcurrentStreamError,
  SessionNotificationPayloadSchema,
  type ConnectedDroidSession,
  type DaemonSessionController,
  type DroidStreamEvent,
  type DroidStreamMessage,
  type SessionSettings,
  type MultiMissionStateManager,
} from '@factory/droid-sdk';
import type {
  DaemonHandlers,
  DaemonNotification,
  DaemonSessionHandle,
  DaemonStreamOptions,
} from './api';
import { DaemonTurnStream } from './sessionStream';
import type { RecoveredDaemonTurn } from './recoveredTurn';

export class RetainedDaemonSession implements DaemonSessionHandle {
  private snapshot: SessionSettings | undefined;
  private cwdSnapshot: string | undefined;
  private pendingSettings: Partial<SessionSettings> = {};
  private pendingCwd: string | undefined;
  private status: 'attached' | 'replacing' | 'detached' = 'attached';
  private active: DaemonTurnStream | undefined;
  private admission: AbortController | undefined;
  private readonly recovered = new Set<RecoveredDaemonTurn>();
  private readonly subscriptions = new Set<() => void>();

  constructor(
    private readonly controller: DaemonSessionController,
    readonly id: string,
    readonly handlers: DaemonHandlers,
    private readonly unregister: () => void,
    private readonly waitUntilReady: (signal?: AbortSignal) => Promise<void> = async () => {},
    private readonly missions?: MultiMissionStateManager,
  ) {}

  get settings(): Readonly<SessionSettings> {
    if (this.snapshot === undefined)
      throw new Error('Session metadata is not initialized');
    return this.snapshot;
  }

  get cwd(): string | undefined {
    return this.cwdSnapshot;
  }

  initialize(settings: SessionSettings, cwd: string | undefined): void {
    this.snapshot = { ...settings, ...this.pendingSettings };
    this.cwdSnapshot = this.pendingCwd ?? cwd;
    this.pendingSettings = {};
    this.pendingCwd = undefined;
  }

  async ensureLoaded(signal?: AbortSignal): Promise<void> {
    this.assertAttached();
    signal?.throwIfAborted();
    await this.waitUntilReady(signal);
    // The SDK shares in-flight loads. Cancelling one admission wait must not
    // interrupt a load used by another reader or send any user message.
    const loading = this.controller.ensureSessionLoaded(this.id);
    let abort: (() => void) | undefined;
    try {
      if (signal) {
        await Promise.race([
          loading,
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          }),
        ]);
      } else await loading;
      signal?.throwIfAborted();
      this.assertAttached();
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }

  observe(notification: DaemonNotification['notification']): void {
    const parsed = SessionNotificationPayloadSchema.safeParse(notification);
    if (!parsed.success) return;
    const value = parsed.data;
    if (value.type === 'session_working_directory_changed') {
      if (this.snapshot === undefined) this.pendingCwd = value.cwd;
      else this.cwdSnapshot = value.cwd;
    } else if (value.type === 'settings_updated') {
      const { specModeModelId, specModeReasoningEffort, ...rest } = value.settings;
      const patch: Partial<SessionSettings> = {
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(specModeModelId === undefined
          ? {}
          : { specModeModelId: specModeModelId ?? undefined }),
        ...(specModeReasoningEffort === undefined
          ? {}
          : { specModeReasoningEffort: specModeReasoningEffort ?? undefined }),
      };
      if (this.snapshot === undefined) Object.assign(this.pendingSettings, patch);
      else this.snapshot = { ...this.snapshot, ...patch };
    }
  }

  onNotification(listener: (notification: Record<string, unknown>) => void): () => void {
    this.assertAttached();
    const receive = (event: DaemonNotification): void => {
      if (event.sessionId === this.id)
        listener({
          jsonrpc: '2.0',
          method: 'droid.session_notification',
          params: event,
        });
    };
    const unsubscribe = (): void => {
      this.controller.off('sessionNotification', receive);
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    this.controller.on('sessionNotification', receive);
    return unsubscribe;
  }

  readMissionSnapshot(): unknown {
    this.assertAttached();
    return this.missions?.getMissionStoreIfKnown(this.id)?.getSnapshot() ?? null;
  }

  subscribeMissionSnapshot(listener: (snapshot: unknown) => void): () => void {
    this.assertAttached();
    let store = this.missions?.getMissionStoreIfKnown(this.id) ?? null;
    const publish = () => listener(store?.getSnapshot() ?? null);
    let unsubscribeStore = store?.subscribe(publish);
    let refreshing = false;
    const unsubscribeManager = this.missions?.subscribe(() => {
      // SDK store creation notifies before the session association is set.
      // Reading a known association can itself create its store, so a nested
      // manager notification must leave the outer refresh in control.
      if (refreshing) return;
      refreshing = true;
      try {
        const next = this.missions?.getMissionStoreIfKnown(this.id) ?? null;
        if (next === store) return;
        unsubscribeStore?.();
        store = next;
        unsubscribeStore = store?.subscribe(publish);
        publish();
      } finally {
        refreshing = false;
      }
    });
    const unsubscribe = () => {
      unsubscribeManager?.();
      unsubscribeStore?.();
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  stream(
    prompt: string,
    options?: DaemonStreamOptions & { includePartialMessages?: false },
  ): AsyncGenerator<DroidStreamMessage>;
  stream(
    prompt: string,
    options: DaemonStreamOptions & { includePartialMessages: true },
  ): AsyncGenerator<DroidStreamEvent>;
  async *stream(
    prompt: string,
    options: DaemonStreamOptions = {},
  ): AsyncGenerator<DroidStreamEvent> {
    this.assertAttached();
    options.abortSignal?.throwIfAborted();
    if (this.active !== undefined || this.admission !== undefined) throw new ConcurrentStreamError(this.id);
    const admission = new AbortController();
    this.admission = admission;
    const aborted = () => admission.abort(options.abortSignal?.reason);
    options.abortSignal?.addEventListener('abort', aborted, { once: true });
    try {
      await this.waitUntilReady(admission.signal);
      admission.signal.throwIfAborted();
      this.assertAttached();
    } finally {
      options.abortSignal?.removeEventListener('abort', aborted);
      if (this.admission === admission) this.admission = undefined;
    }
    const active = new DaemonTurnStream(this.controller, this.id, options, () => {
      if (this.active === active) this.active = undefined;
    }, () => this.waitUntilReady(), (recovery) => {
      this.recovered.add(recovery);
      return () => { this.recovered.delete(recovery); };
    });
    this.active = active;
    yield* active.messages(prompt);
  }

  async interrupt(): Promise<void> {
    this.assertAttached();
    if (this.admission) {
      this.admission.abort(new DOMException('Droid turn interrupted.', 'AbortError'));
      return;
    }
    await this.waitUntilReady();
    if (this.active) await this.active.interrupt();
    else await this.controller.interruptSession(this.id);
  }
  async rename(title: string): Promise<void> {
    this.assertAttached();
    await this.controller.renameSession(this.id, title);
  }
  compact: ConnectedDroidSession['compact'] = (instructions) =>
    this.replace(() => this.controller.compactSession(this.id, instructions));
  fork: ConnectedDroidSession['fork'] = (options) =>
    this.replace(() => this.controller.forkSession(this.id, options));
  rewind: ConnectedDroidSession['rewind'] = (params) =>
    this.replace(() => this.controller.executeRewind(this.id, params));

  async detach(): Promise<void> {
    if (this.status === 'detached') return;
    this.status = 'detached';
    this.admission?.abort(new Error('Session handle is detached'));
    for (const recovery of this.recovered) recovery.dispose();
    this.active?.detach();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.pendingSettings = {};
    this.pendingCwd = undefined;
    this.unregister();
  }
  async close(): Promise<void> {
    this.assertAttached();
    await this.controller.closeSession(this.id);
    await this.detach();
  }
  disconnect(): void {
    this.active?.fail(new Error('Droid connection disconnected'));
    void this.detach();
  }
  reportError(error: Error): void {
    this.active?.fail(error);
  }

  suspendTransport(): void { this.active?.suspendTransport(); }
  restoreTransport(messages: readonly { readonly id: string }[]): void { this.active?.restoreTransport(messages); }
  failTransport(error: Error): void { this.active?.failTransport(error); }

  private async replace<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAttached();
    if (this.active !== undefined || this.admission !== undefined) throw new ConcurrentStreamError(this.id);
    this.status = 'replacing';
    try {
      return await operation();
    } finally {
      if (this.status === 'replacing') this.status = 'attached';
    }
  }
  private assertAttached(): void {
    if (this.status !== 'attached')
      throw new Error(
        this.status === 'detached'
          ? 'Session handle is detached'
          : 'Session replacement is in progress',
      );
  }
}
