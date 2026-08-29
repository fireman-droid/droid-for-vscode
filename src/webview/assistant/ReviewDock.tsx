import { useEffect, useId, useRef, useState } from "react";

import type {
  ChangesTranscriptItem,
  ReviewAgentStateMessage,
  ReviewOperationResultMessage,
  ReviewRestorePreviewStateMessage,
  ReviewScopeKind,
  ReviewScopeState,
} from "../../shared/bridgeMessages";
import { ChangesCommitEntry } from "./GitCommitPanel";
import { ActivityChevron } from "./thread/icons";
import { useDeferredDisclosure } from "./useDeferredDisclosure";

interface ReviewDockProps {
  readonly changes: ChangesTranscriptItem;
  readonly review: ReviewScopeState | null;
  readonly restorePreview: ReviewRestorePreviewStateMessage | null;
  readonly operation: ReviewOperationResultMessage | null;
  readonly agent: ReviewAgentStateMessage | null;
  readonly onOpenScope: (kind: ReviewScopeKind, turnId?: string) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onNavigate: (direction: "previous" | "next") => void;
  readonly onMarkReviewed: (advance: boolean) => void;
  readonly onPreviewRestore: (target: "file" | "turn") => void;
  readonly onConfirmRestore: (target: "file" | "turn", previewId: string) => void;
  readonly onRunAgentReview: () => void;
  readonly deferMount?: boolean;
}

export function ReviewDock({
  changes,
  review,
  restorePreview,
  operation,
  agent,
  onOpenScope,
  onSelectFile,
  onNavigate,
  onMarkReviewed,
  onPreviewRestore,
  onConfirmRestore,
  onRunAgentReview,
  deferMount = false,
}: ReviewDockProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [ready, setReady] = useState(!deferMount);
  const bodyId = useId();
  const moreMenuId = useId();
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!deferMount) {
      setReady(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [deferMount]);
  useEffect(() => {
    if (!expanded) {
      setMoreOpen(false);
    }
  }, [expanded]);
  useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }
    const closeOnOutsideOrEscape = (event: PointerEvent | KeyboardEvent): void => {
      if (
        event instanceof KeyboardEvent &&
        event.key === "Escape"
      ) {
        setMoreOpen(false);
        return;
      }
      if (
        event instanceof PointerEvent &&
        moreMenuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideOrEscape);
    document.addEventListener("keydown", closeOnOutsideOrEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideOrEscape);
      document.removeEventListener("keydown", closeOnOutsideOrEscape);
    };
  }, [moreOpen]);
  const body = useDeferredDisclosure(expanded);
  if (changes.files.length === 0 || !ready) {
    return null;
  }
  const ownsLatestTurn =
    review?.scopeKind === "turn" && review.turnId === changes.turnId;
  const newerChanges =
    review?.scopeKind === "turn" && review.turnId !== changes.turnId;
  const current =
    review?.currentIndex === null || review?.currentIndex === undefined
      ? null
      : review.files[review.currentIndex] ?? null;
  const writing = changes.writing === true || review?.lifecycle === "writing";
  const preview =
    restorePreview?.reviewScopeId === review?.reviewScopeId
      ? restorePreview
      : null;
  const count = `${changes.files.length} ${
    changes.files.length === 1 ? "file" : "files"
  } changed`;
  return (
    <section className="dvx-review-dock" aria-label="Review changes">
      <div className="dvx-review-dock-head">
        <button
          type="button"
          className="dvx-review-dock-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          <ActivityChevron />
          <span className="dvx-review-dock-count">{count}</span>
          {writing ? (
            <span className="dvx-review-dock-writing" role="status">
              <span aria-hidden="true" />
              writing
            </span>
          ) : null}
        </button>
        <div className="dvx-review-dock-actions">
          <button
            type="button"
            className="dvx-review-dock-review"
            onClick={() => {
              setExpanded(true);
              onOpenScope("turn", changes.turnId);
            }}
          >
            {writing ? "View live" : "Review"}
          </button>
        </div>
      </div>
      {body.mounted ? (
        <div
          className="dvx-review-dock-body"
          id={bodyId}
          data-open={body.open ? "true" : "false"}
          aria-hidden={!expanded}
        >
          <div className="dvx-review-dock-body-inner">
            <div className="dvx-review-scope-row">
              {(["turn", "workspace", "branch"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="dvx-review-scope"
                  aria-pressed={
                    kind === "turn"
                      ? ownsLatestTurn
                      : review?.scopeKind === kind
                  }
                  onClick={() =>
                    onOpenScope(
                      kind,
                      kind === "turn" ? changes.turnId : undefined,
                    )
                  }
                >
                  {kind === "turn"
                    ? "Latest Turn"
                    : kind === "workspace"
                      ? "Workspace"
                      : "Branch"}
                </button>
              ))}
              {review !== null ? (
                <span className="dvx-review-progress">
                  {newerChanges
                    ? "Newer changes available"
                    : `${review.reviewedCount} of ${review.reviewableCount} reviewed`}
                </span>
              ) : null}
            </div>
            {review === null ? (
              <div className="dvx-review-dock-branch-note">
                Choose Review to open the latest Turn.
              </div>
            ) : review.lifecycle === "unavailable" ||
              review.lifecycle === "stale" ? (
              <div className="dvx-review-dock-branch-note" role="status">
                {review.message ?? "This review scope is unavailable."}
              </div>
            ) : (
              <>
                <div className="dvx-review-current">
                  <div className="dvx-review-current-meta">
                    <span className="dvx-review-baseline">
                      {review.baselineLabel}
                    </span>
                    <span className="dvx-review-current-path" title={current?.path}>
                      {current?.path ?? "No comparable files"}
                    </span>
                  </div>
                  <div className="dvx-review-nav">
                    <button
                      type="button"
                      disabled={review.currentIndex === null || review.currentIndex === 0}
                      onClick={() => onNavigate("previous")}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={
                        review.currentIndex === null ||
                        review.currentIndex >= review.files.length - 1
                      }
                      onClick={() => onNavigate("next")}
                    >
                      Next
                    </button>
                  </div>
                </div>
                <ul className="dvx-review-dock-files">
                  {review.files.map((file, index) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className="dvx-review-dock-row"
                        data-current={
                          index === review.currentIndex ? "true" : "false"
                        }
                        aria-label={`Open diff for ${file.path}`}
                        onClick={() => onSelectFile(file.path)}
                      >
                        <span
                          className="dvx-review-file-state"
                          data-state={file.status}
                          aria-label={file.status}
                        />
                        <span className="dvx-review-dock-path" title={file.path}>
                          {file.path}
                        </span>
                        <span className="dvx-review-dock-stats">
                          {file.additions === null ? null : (
                            <span className="dvx-changes-add">+{file.additions}</span>
                          )}
                          {file.deletions === null ? null : (
                            <span className="dvx-changes-del">−{file.deletions}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="dvx-review-controls">
                  <button
                    type="button"
                    disabled={
                      writing ||
                      current === null ||
                      current.status === "open-only" ||
                      current.status === "reviewed"
                    }
                    onClick={() => onMarkReviewed(false)}
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    disabled={
                      writing ||
                      current === null ||
                      current.status === "open-only" ||
                      current.status === "reviewed"
                    }
                    onClick={() => onMarkReviewed(true)}
                  >
                    Mark reviewed &amp; Next
                  </button>
                  <span className="dvx-review-controls-spacer" />
                  <div className="dvx-review-more-wrap" ref={moreMenuRef}>
                    <div
                      className="dvx-review-more-menu"
                      id={moreMenuId}
                      data-open={moreOpen ? "true" : "false"}
                      aria-hidden={!moreOpen}
                    >
                      <ChangesCommitEntry
                        key={changes.turnId}
                        turnId={changes.turnId}
                      />
                      {!writing &&
                      review.scopeKind === "turn" &&
                      current?.restorable ? (
                        <button
                          type="button"
                          className="dvx-review-more-item"
                          onClick={() => {
                            setMoreOpen(false);
                            onPreviewRestore("file");
                          }}
                        >
                          Restore file
                        </button>
                      ) : null}
                      {!writing && review.scopeKind === "turn" ? (
                        <button
                          type="button"
                          className="dvx-review-more-item"
                          onClick={() => {
                            setMoreOpen(false);
                            onPreviewRestore("turn");
                          }}
                        >
                          Restore turn
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="dvx-review-more-item"
                        disabled={
                          writing ||
                          (agent?.reviewScopeId === review.reviewScopeId &&
                            (agent.status === "starting" ||
                              agent.status === "running"))
                        }
                        onClick={() => {
                          setMoreOpen(false);
                          onRunAgentReview();
                        }}
                      >
                        {agent?.reviewScopeId === review.reviewScopeId &&
                        (agent.status === "starting" ||
                          agent.status === "running")
                          ? "Agent Review running"
                          : "Agent Review"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="dvx-review-more-trigger"
                      aria-controls={moreMenuId}
                      aria-expanded={moreOpen}
                      aria-haspopup="true"
                      onClick={() => setMoreOpen((value) => !value)}
                    >
                      More
                    </button>
                  </div>
                </div>
                {agent?.reviewScopeId === review.reviewScopeId &&
                (agent.status === "starting" || agent.status === "running") ? (
                  <div className="dvx-review-agent-status" role="status">
                    {agent.message ?? "Agent Review running"}
                  </div>
                ) : null}
                {preview !== null ? (
                  <div className="dvx-review-confirm" role="status">
                    <span>
                      {preview.conflicted.length > 0
                        ? `${preview.conflicted.length} conflict(s), restore is blocked.`
                        : `${preview.restorable.length} file(s) can be restored.`}
                    </span>
                    <button
                      type="button"
                      disabled={preview.conflicted.length > 0}
                      onClick={() =>
                        onConfirmRestore(preview.target, preview.previewId)
                      }
                    >
                      Confirm restore
                    </button>
                  </div>
                ) : null}
                {operation?.reviewScopeId === review.reviewScopeId ? (
                  <div
                    className="dvx-review-result"
                    data-ok={operation.ok ? "true" : "false"}
                    role="status"
                  >
                    {operation.message}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
