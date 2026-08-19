// AssistantMessage: moved verbatim from Thread.tsx (structure-only refactor).

import {
  ActionBarPrimitive,
  MessagePrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ACTIVITY_GROUP_KEY,
  activityGroupBy,
} from "../activityGrouping";
import { GitCommitFlowContext } from "../GitCommitPanel";
import { DroidMarkdownText } from "../MarkdownText";
import { MessageTimestamp } from "../MessageTimestamp";
import { TranscriptImage } from "../TranscriptImage";
import { ForkContext, RegenerateContext } from "../Thread";
import { ActivityGroup, ToolActivityRow } from "./activityRows";
import { CopyActionContent, ForkIcon, RegenerateIcon } from "./icons";
import {
  readReasoningDuration,
  readReasoningTruncated,
  readToolActivity,
} from "./readers";
import { ChangesSummary, Diagnostic, ThinkingRow } from "./transcriptRows";

export const AssistantMessage = memo(function AssistantMessage(): React.JSX.Element {
  // Entry animations are double-gated: the shell needs dvx-anim-live
  // (connected + active turn) and the message itself must be the one
  // streaming, so attaching the root class at turn start never
  // replays history rows. The action bar mounts after streaming
  // ends, so its fade keys off "was live in this mount" instead —
  // recovered history can never satisfy that.
  const running = useAuiState((s) => s.message.status?.type === "running");
  // The newest reply keeps its action bar quietly visible
  // (dvx-message-last); earlier ones reveal it on hover.
  const isLast = useAuiState((s) => s.message.isLast);
  const messageId = useAuiState((s) => s.message.id);
  const gitFlow = useContext(GitCommitFlowContext);
  const includeChanges =
    gitFlow?.latestChangesTurnId === null ||
    gitFlow?.latestChangesTurnId === undefined ||
    messageId !== `assistant-turn:${gitFlow.latestChangesTurnId}`;
  // Completion time stamped when the host/webview saw the turn end;
  // messages rebuilt from public CLI history carry none, and their
  // bar simply shows no age.
  const completedAt = useAuiState((s) => {
    const value = s.message.metadata.custom?.completedAt;
    return typeof value === "number" ? value : null;
  });
  // Interactions split one visible reply across several turnIds; only
  // the run's tail message wears the action bar, middle segments keep
  // the compact body rhythm (user report batch 2 §6).
  const replyTail = useAuiState(
    (s) => s.message.metadata.custom?.replyTail !== false,
  );
  const replyCopyText = useAuiState((s) => {
    const value = s.message.metadata.custom?.replyCopyText;
    return typeof value === "string" ? value : null;
  });
  const wasRunningRef = useRef(false);
  if (running) {
    wasRunningRef.current = true;
  }
  return (
    <MessagePrimitive.Root
      className={`dvx-message dvx-message-assistant${
        running ? " dvx-message-live" : ""
      }${isLast ? " dvx-message-last" : ""}${
        replyTail ? "" : " dvx-message-cont"
      }`}
      aria-label="Droid"
    >
      <AssistantMessageParts includeChanges={includeChanges} />
      {replyTail ? (
        <ActionBarPrimitive.Root
          className={`dvx-assistant-actions${
            !running && wasRunningRef.current ? " dvx-actions-entry" : ""
          }`}
          hideWhenRunning
        >
          <MessageTimestamp completedAt={completedAt} />
          {replyCopyText !== null ? (
            <ReplyCopyAction text={replyCopyText} />
          ) : (
            <ActionBarPrimitive.Copy
              className="dvx-message-action dvx-copy-action"
              aria-label="Copy response"
              copiedDuration={1500}
            >
              <CopyActionContent />
            </ActionBarPrimitive.Copy>
          )}
          <MessagePrimitive.If last>
            <RegenerateAction />
            <ForkAction />
          </MessagePrimitive.If>
        </ActionBarPrimitive.Root>
      ) : null}
    </MessagePrimitive.Root>
  );
});

/** Main message body shared by the live thread and read-only child playback. */
export function AssistantMessageParts({
  includeChanges,
}: {
  readonly includeChanges: boolean;
}): React.JSX.Element {
  return (
    <MessagePrimitive.GroupedParts
      groupBy={activityGroupBy}
      indicator="never"
    >
      {({ part, children }) => {
        switch (part.type) {
          case ACTIVITY_GROUP_KEY:
            return (
              <ActivityGroup indices={part.indices}>{children}</ActivityGroup>
            );
          case "text":
            return <DroidMarkdownText />;
          case "reasoning":
            return (
              <ThinkingRow
                statusType={part.status?.type}
                durationMs={readReasoningDuration(part)}
                truncated={readReasoningTruncated(part)}
              />
            );
          case "tool-call":
            return (
              <ToolActivityRow
                activity={readToolActivity(part)}
                toolName={part.toolName}
                toolUseId={part.toolCallId}
              />
            );
          case "data":
            if (part.name === "droid-diagnostic") {
              return <Diagnostic data={part.data} />;
            }
            if (part.name === "droid-changes") {
              return includeChanges ? <ChangesSummary data={part.data} /> : null;
            }
            if (part.name === "droid-image") {
              return <TranscriptImage data={part.data} />;
            }
            return null;
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

/** Child-session assistant message: identical body, no reply actions. */
export function ReadOnlyAssistantMessage(): React.JSX.Element {
  const running = useAuiState(
    (state) => state.message.status?.type === "running",
  );
  return (
    <MessagePrimitive.Root
      className={`dvx-message dvx-message-assistant${
        running ? " dvx-message-live" : ""
      }`}
      aria-label="Subagent"
    >
      <AssistantMessageParts includeChanges={false} />
    </MessagePrimitive.Root>
  );
}

/**
 * Copies the whole reply run — every assistant text segment of the
 * turn sequence, blank lines between segments — instead of only this
 * message's text. Mirrors ActionBarPrimitive.Copy's visuals via the
 * same classes and data-copied attribute.
 */
export function ReplyCopyAction({
  text,
}: {
  readonly text: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current !== null) {
        clearTimeout(resetRef.current);
      }
    },
    [],
  );
  return (
    <button
      type="button"
      className="dvx-message-action dvx-copy-action"
      aria-label="Copy response"
      {...(copied ? { "data-copied": "true" } : {})}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        if (resetRef.current !== null) {
          clearTimeout(resetRef.current);
        }
        resetRef.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <CopyActionContent />
    </button>
  );
}

export function RegenerateAction(): React.JSX.Element | null {
  const regenerate = useContext(RegenerateContext);
  const [busy, setBusy] = useState(false);
  const busyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (busyResetRef.current !== null) {
        clearTimeout(busyResetRef.current);
      }
    },
    [],
  );
  if (regenerate === null) {
    return null;
  }
  return (
    <button
      className="dvx-message-action"
      type="button"
      aria-label="Regenerate response"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        regenerate();
        // The forked snapshot replaces this thread on success; if the
        // host declines it only emits a diagnostic, so recover the
        // button after a grace period.
        if (busyResetRef.current !== null) {
          clearTimeout(busyResetRef.current);
        }
        busyResetRef.current = setTimeout(() => setBusy(false), 8000);
      }}
    >
      <RegenerateIcon />
      <span>{busy ? "Regenerating…" : "Regenerate"}</span>
    </button>
  );
}

export function ForkAction(): React.JSX.Element | null {
  const fork = useContext(ForkContext);
  const [busy, setBusy] = useState(false);
  const busyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (busyResetRef.current !== null) {
        clearTimeout(busyResetRef.current);
      }
    },
    [],
  );
  if (fork === null) {
    return null;
  }
  return (
    <button
      className="dvx-message-action"
      type="button"
      aria-label="Fork chat"
      title="Branch a new session from this point"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        fork();
        // The host adopts the forked session on success; if it
        // declines it only emits a diagnostic, so recover the button
        // after a grace period (same pattern as Regenerate).
        if (busyResetRef.current !== null) {
          clearTimeout(busyResetRef.current);
        }
        busyResetRef.current = setTimeout(() => setBusy(false), 8000);
      }}
    >
      <ForkIcon />
      <span>{busy ? "Forking…" : "Fork chat"}</span>
    </button>
  );
}
