import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useMemo, useRef } from "react";

import {
  MAX_TURN_TEXT_LENGTH,
  type SentAttachmentSummary,
  type SessionTranscriptItem,
  type TurnStatus,
} from "../../shared/bridgeMessages";
import { MAX_QUEUED_MESSAGES } from "../../shared/queueProtocol";
import { formatSelectionQuote } from "./selectionQuote";
import { type AssistantWebviewState } from "./store";

export interface SafeRuntimeMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: ThreadMessageLike["content"];
  readonly status?: ThreadMessageLike["status"];
  readonly optimistic?: boolean;
  /** SDK message id for user messages that can anchor a rewind. */
  readonly messageId?: string;
  /** Chip metadata for the attachments a user message was sent with. */
  readonly attachments?: readonly SentAttachmentSummary[];
  /** Epoch ms when this assistant reply was seen finishing, if known. */
  readonly completedAt?: number;
  /**
   * False for assistant messages that merely continue a reply run
   * (interactions split one visible reply across several turnIds);
   * the action bar renders only on the run's tail.
   */
  readonly replyTail?: boolean;
  /** Tail-only: every assistant text segment of the run, joined with
   * blank lines — what Copy places on the clipboard. */
  readonly replyCopyText?: string;
}

type SafeRuntimePart = Exclude<ThreadMessageLike["content"], string>[number];

export interface RuntimeAdapterCallbacks {
  readonly onSend: (text: string) => Promise<void> | void;
  readonly onCancel: () => Promise<void> | void;
  readonly isSendDisabled?: boolean;
}

/**
 * Long sessions mount only the trailing message window by default. Rendering
 * every message makes assistant-ui's per-update store notifications and the
 * DOM grow with session length; at a 200-message window each streamed delta
 * cost ~50ms of main-thread work and session recovery blocked for seconds,
 * so the window stays small and "Show earlier messages" loads the rest.
 */
export const DEFAULT_MESSAGE_WINDOW = 60;
export const MESSAGE_WINDOW_STEP = 120;

export interface DroidRuntimeWindow {
  readonly runtime: AssistantRuntime;
  readonly hiddenMessageCount: number;
}

export interface SendEligibility {
  readonly connectionStatus: AssistantWebviewState["connection"]["status"];
  readonly sessionId: string | null;
  readonly turnStatus: TurnStatus | null;
  readonly interactionCount: number;
  /** Prompts already queued behind the running turn. */
  readonly queuedCount: number;
  /**
   * A queued prompt is loaded into the Composer ("Edit Queued").
   * Saving replaces that prompt in place, so the full-queue guard
   * does not apply to it.
   */
  readonly queueEditing: boolean;
}

/**
 * Whether a committed send routes to `queue.add` instead of
 * `turn.send`: while a turn runs, and while the queue is non-empty
 * (a paused queue must stay ordered — no overtaking by direct send).
 */
export function shouldQueueMessage(
  eligibility: Pick<SendEligibility, "turnStatus" | "queuedCount">,
): boolean {
  return (
    eligibility.turnStatus === "submitting" ||
    eligibility.turnStatus === "streaming" ||
    eligibility.turnStatus === "stopping" ||
    eligibility.queuedCount > 0
  );
}

export function canSendMessage(
  eligibility: SendEligibility,
  text?: string,
  additionallyDisabled = false,
): eligibility is SendEligibility & { readonly sessionId: string } {
  if (
    eligibility.connectionStatus !== "connected" ||
    eligibility.sessionId === null ||
    additionallyDisabled
  ) {
    return false;
  }
  if (shouldQueueMessage(eligibility)) {
    // The queue route stays open during interactions (queueing does
    // not touch the running turn); only a full queue closes it —
    // unless the send replaces a prompt already in the queue.
    if (
      eligibility.queuedCount >= MAX_QUEUED_MESSAGES &&
      !eligibility.queueEditing
    ) {
      return false;
    }
  } else if (eligibility.interactionCount > 0) {
    return false;
  }
  return (
    text === undefined ||
    (text.trim().length > 0 && text.length <= MAX_TURN_TEXT_LENGTH)
  );
}

export function useDroidExternalStoreRuntime(
  state: AssistantWebviewState,
  callbacks: RuntimeAdapterCallbacks,
  messageWindow: number = DEFAULT_MESSAGE_WINDOW,
): DroidRuntimeWindow {
  const messageCacheRef = useRef<RuntimeMessageCache>(new Map());
  const completionClockRef = useRef<CompletionClock>(new Map());
  const { messages, hiddenMessageCount } = useMemo(() => {
    const all = mapTranscriptToRuntimeMessages(
      state.transcript,
      state.turn,
      messageCacheRef.current,
      completionClockRef.current,
    );
    if (all.length <= messageWindow) {
      return { messages: all, hiddenMessageCount: 0 };
    }
    return {
      messages: all.slice(all.length - messageWindow),
      hiddenMessageCount: all.length - messageWindow,
    };
  }, [messageWindow, state.transcript, state.turn]);
  const adapter = useMemo(
    () => createRuntimeAdapter(state, messages, callbacks),
    [callbacks, messages, state],
  );
  const runtime = useExternalStoreRuntime(adapter);
  return useMemo(
    () => ({ runtime, hiddenMessageCount }),
    [hiddenMessageCount, runtime],
  );
}

export function createRuntimeAdapter(
  state: AssistantWebviewState,
  messages: readonly SafeRuntimeMessage[],
  callbacks: RuntimeAdapterCallbacks,
): ExternalStoreAdapter<SafeRuntimeMessage> {
  const sendEligibility: SendEligibility = {
    connectionStatus: state.connection.status,
    sessionId: state.sessionId,
    turnStatus: state.turn?.status ?? null,
    interactionCount: state.interactions.length,
    queuedCount: state.queue.items.length,
    queueEditing: state.queueEditing !== null,
  };
  return {
    messages,
    // `stopping` still routes the next prompt through the queue, but the
    // cancelled run is no longer generating. Keeping assistant-ui in a
    // running state here can reject Composer sends until host settlement.
    isRunning:
      state.turn?.status === "submitting" ||
      state.turn?.status === "streaming",
    isSendDisabled: !canSendMessage(
      sendEligibility,
      undefined,
      callbacks.isSendDisabled === true,
    ),
    convertMessage: convertSafeRuntimeMessage,
    onNew: async (message) => {
      const text = extractText(message);
      if (
        !canSendMessage(
          sendEligibility,
          text,
          callbacks.isSendDisabled === true,
        )
      ) {
        return;
      }
      await callbacks.onSend(text);
    },
    ...(state.turn !== null &&
    (state.turn.status === "submitting" || state.turn.status === "streaming")
      ? { onCancel: async () => callbacks.onCancel() }
      : {}),
  };
}

export function convertSafeRuntimeMessage(
  message: SafeRuntimeMessage,
): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.status === undefined ? {} : { status: message.status }),
    metadata: {
      ...(message.optimistic ? { isOptimistic: true } : {}),
      custom: {
        messageId: message.messageId ?? null,
        attachments: message.attachments ?? null,
        completedAt: message.completedAt ?? null,
        // Absent (user messages, non-adapter paths) means tail so the
        // bar never silently disappears.
        replyTail: message.replyTail ?? true,
        replyCopyText: message.replyCopyText ?? null,
      },
    },
  };
}

export function extractText(message: AppendMessage): string {
  const body = message.content
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map(({ text }) => text)
    .join("");
  const quote = message.metadata.custom?.quote;
  return formatSelectionQuote(
    typeof quote === "object" &&
      quote !== null &&
      "text" in quote &&
      typeof quote.text === "string"
      ? quote.text
      : "",
    body,
  );
}

interface RuntimeMessageCacheEntry {
  readonly message: SafeRuntimeMessage;
  readonly items: readonly SessionTranscriptItem[];
  readonly stateKey: string;
}

export type RuntimeMessageCache = Map<string, RuntimeMessageCacheEntry>;

/**
 * Completion times observed inside this webview. An assistant message
 * first seen streaming is marked "streaming" and stamped with the wall
 * clock when it settles; one first seen already settled (history,
 * recovery) is marked "settled" and never receives a fabricated time.
 * The bridge does not carry completion times yet, so stamps live only
 * as long as the webview does — the action bar simply omits the age
 * where none is known.
 */
export type CompletionClock = Map<string, number | "streaming" | "settled">;

function observeCompletion(
  clock: CompletionClock,
  id: string,
  running: boolean,
): number | undefined {
  const prior = clock.get(id);
  if (typeof prior === "number") {
    return prior;
  }
  if (running) {
    clock.set(id, "streaming");
    return undefined;
  }
  if (prior === "streaming") {
    const stamped = Date.now();
    clock.set(id, stamped);
    return stamped;
  }
  clock.set(id, "settled");
  return undefined;
}

interface UserMessageDescriptor {
  readonly kind: "user";
  readonly item: Extract<SessionTranscriptItem, { kind: "user" }>;
  /** User-origin images sent with this prompt, rendered in the bubble. */
  readonly images: Extract<SessionTranscriptItem, { kind: "image" }>[];
}

interface AssistantGroupDescriptor {
  readonly kind: "assistant";
  readonly id: string;
  readonly turnId: string;
  readonly items: SessionTranscriptItem[];
}

export function mapTranscriptToRuntimeMessages(
  transcript: readonly SessionTranscriptItem[],
  turn: Pick<
    NonNullable<AssistantWebviewState["turn"]>,
    "turnId" | "status"
  > | null,
  cache?: RuntimeMessageCache,
  completionClock?: CompletionClock,
): readonly SafeRuntimeMessage[] {
  const descriptors: (UserMessageDescriptor | AssistantGroupDescriptor)[] = [];
  const groups = new Map<string, AssistantGroupDescriptor>();

  const appendToGroup = (
    item: Exclude<SessionTranscriptItem, { kind: "user" }>,
  ): void => {
    const key = item.turnId ?? `diagnostic:${item.id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        kind: "assistant",
        id: `assistant-turn:${key}`,
        turnId: key,
        items: [],
      };
      groups.set(key, group);
      descriptors.push(group);
    }
    group.items.push(item);
  };

  // A user-origin image belongs to the prompt it was sent with, but the
  // two projections order them differently: the live echo emits images
  // right AFTER the user text, while history projection walks the raw
  // message's content blocks, where the CLI stores images BEFORE the
  // text (measured over real session files: always `image,…,text`).
  // Leading images are buffered here until their adjacent user item
  // adopts them; only an image with no prompt on either side falls
  // through to the turn group and renders standalone.
  let pendingUserImages: Extract<
    SessionTranscriptItem,
    { kind: "image" }
  >[] = [];
  const flushPendingUserImages = (): void => {
    for (const image of pendingUserImages) {
      appendToGroup(image);
    }
    pendingUserImages = [];
  };

  for (const item of transcript) {
    if (item.kind === "user") {
      descriptors.push({ kind: "user", item, images: pendingUserImages });
      pendingUserImages = [];
      continue;
    }
    if (item.kind === "image" && item.origin === "user") {
      const last = descriptors[descriptors.length - 1];
      if (last?.kind === "user") {
        last.images.push(item);
      } else {
        pendingUserImages.push(item);
      }
      continue;
    }
    flushPendingUserImages();
    // Plan checklists render once, as PlanLine under the creating
    // user message. Streaming them as tool-call rows left every
    // TodoWrite snapshot in history as an extra card.
    if (item.kind === "tool" && item.detailKind === "plan") {
      continue;
    }
    appendToGroup(item);
  }
  flushPendingUserImages();

  // Reply runs: maximal stretches of consecutive assistant descriptors
  // (user messages break them; AskUser/plan approvals split one visible
  // reply across several turnIds). One action bar per run, on the last
  // descriptor that carries assistant text — or the run's last when
  // none does, so Regenerate/Fork stay reachable (user report batch 2
  // §6). The tail also carries the whole run's text for Copy.
  const replyTails = new Map<string, string>();
  let run: AssistantGroupDescriptor[] = [];
  const flushRun = (): void => {
    if (run.length === 0) {
      return;
    }
    let tail = run[run.length - 1]!;
    for (let index = run.length - 1; index >= 0; index -= 1) {
      if (run[index]!.items.some((item) => item.kind === "assistant")) {
        tail = run[index]!;
        break;
      }
    }
    const copyText = run
      .flatMap((descriptor) =>
        descriptor.items
          .filter(
            (item): item is Extract<
              SessionTranscriptItem,
              { kind: "assistant" }
            > => item.kind === "assistant",
          )
          .map((item) => item.text),
      )
      .filter((text) => text.length > 0)
      .join("\n\n");
    replyTails.set(tail.id, copyText);
    run = [];
  };
  for (const descriptor of descriptors) {
    if (descriptor.kind === "assistant") {
      run.push(descriptor);
    } else {
      flushRun();
    }
  }
  flushRun();

  // Reuse prior message identities when the underlying transcript items and
  // derived state are unchanged, so assistant-ui's per-message conversion
  // cache stays warm and untouched messages skip re-rendering during
  // streaming.
  const nextEntries: [string, RuntimeMessageCacheEntry][] = [];
  const messages = descriptors.map((descriptor): SafeRuntimeMessage => {
    if (descriptor.kind === "user") {
      const item = descriptor.item;
      const optimistic =
        item.id.startsWith("user:") &&
        turn?.turnId === item.id.slice("user:".length) &&
        turn.status === "submitting";
      const stateKey = optimistic ? "optimistic" : "sent";
      const identityItems = [item, ...descriptor.images];
      const cached = cache?.get(item.id);
      if (
        cached !== undefined &&
        cached.stateKey === stateKey &&
        sameItemIdentities(cached.items, identityItems)
      ) {
        nextEntries.push([item.id, cached]);
        return cached.message;
      }
      const message: SafeRuntimeMessage = {
        id: item.id,
        role: "user",
        // Thumbs above the prompt text, matching the composer's
        // pending-attachment layout.
        content: [
          ...descriptor.images.map((item) => mapItemToPart(item)),
          { type: "text", text: item.text },
        ],
        optimistic,
        ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
        ...(item.attachments === undefined
          ? {}
          : { attachments: item.attachments }),
      };
      nextEntries.push([item.id, { message, items: identityItems, stateKey }]);
      return message;
    }

    const status = resolveAssistantStatus(
      descriptor.items,
      descriptor.turnId,
      turn,
    );
    // The clock must observe every pass (even cache hits) so the
    // streaming → settled transition is stamped exactly once; the
    // transition also changes stateKey, rebuilding the message with
    // the stamp in the same pass.
    const completedAt =
      completionClock === undefined
        ? undefined
        : observeCompletion(
            completionClock,
            descriptor.id,
            status.type === "running",
          );
    const replyCopyText = replyTails.get(descriptor.id);
    const replyTail = replyCopyText !== undefined;
    // Tail-ness and the aggregated copy text are derived from OTHER
    // descriptors too, so they participate in the cache key: a former
    // tail rebuilds without its bar when the run grows, and a tail
    // rebuilds when any run segment's text changes length.
    const stateKey = `${status.type}:${
      "reason" in status ? status.reason : ""
    }:${replyTail ? `tail:${replyCopyText.length}` : "cont"}`;
    const cached = cache?.get(descriptor.id);
    if (
      cached !== undefined &&
      cached.stateKey === stateKey &&
      sameItemIdentities(cached.items, descriptor.items)
    ) {
      nextEntries.push([descriptor.id, cached]);
      return cached.message;
    }
    const message: SafeRuntimeMessage = {
      id: descriptor.id,
      role: "assistant",
      content: uniqueToolCallIds(
        descriptor.items.map((item) =>
          mapItemToPart(item, status.type === "running"),
        ),
      ),
      status,
      ...(completedAt === undefined ? {} : { completedAt }),
      replyTail,
      ...(replyCopyText === undefined ? {} : { replyCopyText }),
    };
    nextEntries.push([
      descriptor.id,
      { message, items: descriptor.items, stateKey },
    ]);
    return message;
  });

  if (cache !== undefined) {
    cache.clear();
    for (const [id, entry] of nextEntries) {
      cache.set(id, entry);
    }
  }
  if (completionClock !== undefined) {
    const liveIds = new Set(messages.map((message) => message.id));
    for (const key of [...completionClock.keys()]) {
      if (!liveIds.has(key)) {
        completionClock.delete(key);
      }
    }
  }
  return messages;
}

function sameItemIdentities(
  a: readonly SessionTranscriptItem[],
  b: readonly SessionTranscriptItem[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * assistant-ui throws (and React unmounts the whole tree) when two
 * tool-call parts in one message share a toolCallId. Persisted recovery
 * checkpoints written before the reconcile fix can still contain such
 * duplicates, so uniquify defensively at the render boundary.
 */
function uniqueToolCallIds(
  parts: readonly SafeRuntimePart[],
): readonly SafeRuntimePart[] {
  const seen = new Set<string>();
  return parts.map((part) => {
    // toolCallId is optional on the library part type; our
    // mapItemToPart always sets it, but the narrowing is type-mandated.
    if (part.type !== "tool-call" || part.toolCallId === undefined) {
      return part;
    }
    const base = part.toolCallId;
    let id = base;
    let collision = 0;
    while (seen.has(id)) {
      collision += 1;
      id = `${base}#${collision}`;
    }
    seen.add(id);
    return id === base ? part : { ...part, toolCallId: id };
  });
}

function mapItemToPart(
  item: SessionTranscriptItem,
  messageRunning = false,
): SafeRuntimePart {
  switch (item.kind) {
    case "assistant":
      return {
        type: "text",
        text: item.text,
        ...(item.text.length === 0 && messageRunning
          ? { status: { type: "running" as const } }
          : {}),
      };
    case "thinking":
      return {
        type: "reasoning",
        text: item.text,
        status: mapActivityStatus(item.status),
        providerMetadata: {
          droidvisx: {
            durationMs: item.durationMs ?? null,
            truncated: item.truncated,
          },
        },
      };
    case "tool":
      return {
        type: "tool-call",
        toolCallId: item.toolUseId,
        toolName: item.toolName,
        args: {},
        argsText: "",
        providerMetadata: {
          droidvisx: {
            turnId: item.turnId,
            action: item.action,
            status: item.status,
            progressCount: item.progressCount,
            latestUpdateKind: item.latestUpdateKind,
            durationMs: item.durationMs ?? null,
            filePath: item.filePath ?? null,
            detailKind: item.detailKind ?? null,
            detail: item.detail ?? null,
            target: item.target ?? null,
            errorMessage: item.errorMessage ?? null,
            outputTail: item.outputTail ?? null,
            // Rebuilt as literals: interfaces lack the index
            // signature ReadonlyJSONValue requires.
            backgroundHint:
              item.backgroundHint === undefined
                ? null
                : {
                    fireAndForget: item.backgroundHint.fireAndForget,
                  },
            subagent:
              item.subagent === undefined
                ? null
                : {
                    type: item.subagent.type,
                    description: item.subagent.description,
                    status: item.subagent.status ?? null,
                    toolUseCount: item.subagent.toolUseCount ?? null,
                    durationMs: item.subagent.durationMs ?? null,
                  },
          },
        },
      };
    case "changes":
      return {
        type: "data",
        name: "droid-changes",
        data: {
          turnId: item.turnId,
          writing: item.writing === true,
          files: item.files.map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
          })),
        },
      };
    case "ask-user-result":
      return {
        type: "data",
        name: "droid-ask-user-result",
        data:
          item.status === "cancelled"
            ? { status: "cancelled" }
            : {
                status: "answered",
                answers: item.answers.map(({ topic, question, answer }) => ({
                  topic,
                  ...(question === undefined ? {} : { question }),
                  answer,
                })),
              },
      };
    case "diagnostic":
      return {
        type: "data",
        name: "droid-diagnostic",
        data: {
          severity: item.severity,
          code: item.code.slice(0, 256),
          message: item.message.slice(0, 4_096),
          ...(item.relatedSessionId === undefined
            ? {}
            : { relatedSessionId: item.relatedSessionId }),
        },
      };
    case "image":
      return {
        type: "data",
        name: "droid-image",
        data: {
          origin: item.origin,
          mediaType: item.mediaType,
          data: item.data,
          generated: item.generated,
          byteLength: item.byteLength,
        },
      };
    case "user":
      return { type: "text", text: item.text };
  }
}

function mapActivityStatus(
  status: Extract<SessionTranscriptItem, { kind: "thinking" }>["status"],
):
  | { type: "running" }
  | { type: "complete" }
  | {
      type: "incomplete";
      reason: "cancelled";
    } {
  if (status === "active") {
    return { type: "running" };
  }
  if (status === "stopping" || status === "stopped") {
    return { type: "incomplete", reason: "cancelled" };
  }
  return { type: "complete" };
}

function resolveAssistantStatus(
  items: readonly SessionTranscriptItem[],
  turnId: string,
  turn: AssistantWebviewState["turn"],
): NonNullable<ThreadMessageLike["status"]> {
  if (turn?.turnId === turnId) {
    return mapTurnStatus(turn.status);
  }
  const hasRunning = items.some(
    (item) =>
      (item.kind === "thinking" &&
        item.status === "active") ||
      (item.kind === "tool" && item.status === "running"),
  );
  if (hasRunning) {
    return { type: "running" };
  }
  const hasFailure = items.some(
    (item) =>
      (item.kind === "tool" && item.status === "failed") ||
      (item.kind === "diagnostic" && item.severity === "error"),
  );
  if (hasFailure) {
    return { type: "incomplete", reason: "error" };
  }
  const wasStopped = items.some(
    (item) =>
      (item.kind === "tool" &&
        (item.status === "stopping" || item.status === "stopped")) ||
      (item.kind === "thinking" &&
        (item.status === "stopping" || item.status === "stopped")),
  );
  return wasStopped
    ? { type: "incomplete", reason: "cancelled" }
    : { type: "complete", reason: "stop" };
}

function mapTurnStatus(
  status: TurnStatus,
): NonNullable<ThreadMessageLike["status"]> {
  switch (status) {
    case "submitting":
    case "streaming":
      return { type: "running" };
    case "stopping":
      return { type: "incomplete", reason: "cancelled" };
    case "interrupted":
      return { type: "incomplete", reason: "cancelled" };
    case "failed":
      return { type: "incomplete", reason: "error" };
    case "idle":
    case "completed":
      return { type: "complete", reason: "stop" };
  }
}
