import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  type GitStatusFile,
} from "../../shared/gitCommitFlow";
import { buildCommitMessageDraft } from "./gitCommitDraft";
import type { GitCommitFlowState } from "./store";

/**
 * Inline commit panel behind the quiet entry at the tail of the
 * latest changes card (slice A of the git/PR workflow design). All
 * Bridge traffic flows through the context callbacks that App wires
 * up, so the memoized message tree stays free of prop drilling —
 * same pattern as Thread's FileDiffContext.
 */

export interface GitCommitFlowContextValue {
  readonly state: GitCommitFlowState;
  /** Turn of the transcript's latest changes card, if any. */
  readonly latestChangesTurnId: string | null;
  /** Prompt that produced the latest changes card. */
  readonly promptText: string | null;
  readonly onRequestStatus: () => void;
  readonly onCommit: (
    turnId: string,
    paths: readonly string[],
    message: string,
  ) => void;
}

export const GitCommitFlowContext =
  createContext<GitCommitFlowContextValue | null>(null);

/**
 * Quiet text action seated in the changes-ledger footer. Only the
 * latest ledger shows it, and only while git is not
 * known-unavailable; the availability probe runs once on mount so a
 * workspace without `vscode.git` never flashes the entry.
 */
export function ChangesCommitEntry({
  turnId,
}: {
  readonly turnId: string | null;
}): React.JSX.Element | null {
  const flow = useContext(GitCommitFlowContext);
  const [expanded, setExpanded] = useState(false);
  const isLatest =
    flow !== null &&
    turnId !== null &&
    flow.latestChangesTurnId === turnId;
  const availability = flow?.state.availability ?? "unavailable";
  const statusPending = flow?.state.statusPending ?? false;
  const onRequestStatus = flow?.onRequestStatus;
  useEffect(() => {
    if (
      isLatest &&
      availability === "unknown" &&
      !statusPending &&
      onRequestStatus !== undefined
    ) {
      onRequestStatus();
    }
  }, [isLatest, availability, statusPending, onRequestStatus]);
  const committedOk =
    flow !== null &&
    flow.state.lastResult?.ok === true &&
    flow.state.commitTurnId === turnId;
  useEffect(() => {
    if (committedOk) {
      setExpanded(false);
    }
  }, [committedOk]);
  if (flow === null || !isLatest) {
    return null;
  }
  if (committedOk && flow.state.lastResult?.ok === true) {
    const { hash, subject } = flow.state.lastResult;
    return (
      <div className="dvx-commit-result" role="status">
        Committed{hash === "" ? "" : ` ${hash}`}
        {subject === "" ? "" : ` · ${subject}`}
      </div>
    );
  }
  if (availability !== "available") {
    return null;
  }
  if (!expanded) {
    return (
      <button
        type="button"
        className="dvx-changes-action dvx-changes-commit"
        onClick={() => {
          flow.onRequestStatus();
          setExpanded(true);
        }}
      >
        Commit…
      </button>
    );
  }
  return (
    <GitCommitPanel
      flow={flow}
      turnId={turnId}
      onClose={() => setExpanded(false)}
    />
  );
}

const FILE_STATUS_LABELS: Record<GitStatusFile["status"], string> = {
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "new",
  conflicted: "conflicted",
};

function GitCommitPanel({
  flow,
  turnId,
  onClose,
}: {
  readonly flow: GitCommitFlowContextValue;
  readonly turnId: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { state, promptText } = flow;
  const ready =
    state.availability === "available" && !state.statusPending;
  const [initialized, setInitialized] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!ready || initialized) {
      return;
    }
    const defaults = state.files
      .filter((file) => file.inTurn)
      .map((file) => file.path);
    setSelected(new Set(defaults));
    setMessage(buildCommitMessageDraft(promptText, defaults.length));
    setInitialized(true);
  }, [ready, initialized, state.files, promptText]);

  const toggle = (path: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const failure =
    state.lastResult !== null &&
    !state.lastResult.ok &&
    state.commitTurnId === turnId
      ? state.lastResult.error
      : null;
  const canCommit =
    initialized &&
    !state.commitPending &&
    selected.size > 0 &&
    message.trim() !== "";

  let body: React.JSX.Element;
  if (!initialized) {
    body = <div className="dvx-commit-hint">Reading git status…</div>;
  } else if (state.files.length === 0) {
    body = (
      <div className="dvx-commit-hint">No uncommitted changes.</div>
    );
  } else {
    body = (
      <>
        <div
          className="dvx-commit-files"
          role="group"
          aria-label="Files to commit"
        >
          {state.files.map((file) => (
            <label key={file.path} className="dvx-commit-file">
              <input
                type="checkbox"
                checked={selected.has(file.path)}
                disabled={state.commitPending}
                onChange={() => toggle(file.path)}
              />
              <span
                className="dvx-commit-file-path"
                title={file.path}
              >
                {file.path}
              </span>
              <span className="dvx-commit-file-meta">
                {FILE_STATUS_LABELS[file.status]}
                {file.staged ? " · staged" : ""}
              </span>
            </label>
          ))}
        </div>
        <textarea
          className="dvx-commit-message"
          aria-label="Commit message"
          rows={3}
          maxLength={MAX_GIT_COMMIT_MESSAGE_LENGTH}
          placeholder="Commit message"
          value={message}
          disabled={state.commitPending}
          onChange={(event) => setMessage(event.target.value)}
        />
        {failure === null ? null : (
          <div className="dvx-commit-error" role="alert">
            {failure}
          </div>
        )}
        <div className="dvx-commit-actions">
          <button
            type="button"
            className="dvx-commit-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dvx-commit-submit"
            disabled={!canCommit}
            onClick={() => {
              flow.onCommit(turnId, [...selected], message);
            }}
          >
            {state.commitPending ? "Committing…" : "Commit"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className="dvx-commit-panel"
      role="group"
      aria-label="Commit changes"
    >
      <div className="dvx-commit-head">
        <span className="dvx-commit-title">Commit</span>
        {state.branch === null ? null : (
          <span className="dvx-commit-branch">
            on {state.branch}
          </span>
        )}
      </div>
      {body}
    </div>
  );
}
