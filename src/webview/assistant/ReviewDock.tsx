import { useEffect, useId, useState } from "react";

import type {
  ChangesTranscriptItem,
  GitBranchDiffState,
} from "../../shared/bridgeMessages";
import { isPreviewableFilePath } from "../../shared/validateMessage";
import { ChangesCommitEntry } from "./GitCommitPanel";
import { ActivityChevron } from "./thread/icons";
import { useDeferredDisclosure } from "./useDeferredDisclosure";

interface ReviewDockProps {
  readonly changes: ChangesTranscriptItem;
  readonly onOpenFileDiff: (
    path: string,
    turnId: string | null,
  ) => void;
  readonly onPreviewFile: (path: string) => void;
  /** Latest answer to `onRequestBranchDiff`, null before the first. */
  readonly branchDiff: GitBranchDiffState | null;
  readonly onRequestBranchDiff: () => void;
  readonly onOpenFile: (path: string) => void;
  /** Lets assistant-ui commit the matching transcript projection first. */
  readonly deferMount?: boolean;
}

/**
 * Latest-turn Changes surface pinned to the viewport footer. Its
 * expansion state is local presentation state; App keys the component
 * by session + turn so a new turn cannot inherit the old dock.
 */
export function ReviewDock({
  changes,
  onOpenFileDiff,
  onPreviewFile,
  branchDiff,
  onRequestBranchDiff,
  onOpenFile,
  deferMount = false,
}: ReviewDockProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [branchView, setBranchView] = useState(false);
  const [ready, setReady] = useState(!deferMount);
  const filesId = useId();
  useEffect(() => {
    if (!deferMount) {
      setReady(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [deferMount]);
  // Each body mounts once the reader opens it, then stays mounted
  // (collapsed via CSS) so both open and close animate; a turn no
  // one ever expands never pays for the row/list markup at all.
  const showFiles = expanded && !branchView;
  const showBranch = expanded && branchView;
  const files = useDeferredDisclosure(showFiles);
  const branch = useDeferredDisclosure(showBranch);
  if (changes.files.length === 0 || !ready) {
    return null;
  }
  const count = `${changes.files.length} ${
    changes.files.length === 1 ? "file" : "files"
  } changed`;
  const reviewAll = (): void => {
    for (const file of changes.files) {
      onOpenFileDiff(file.path, changes.turnId);
    }
  };
  return (
    <section className="dvx-review-dock" aria-label="Review latest changes">
      <div className="dvx-review-dock-head">
        <button
          type="button"
          className="dvx-review-dock-toggle"
          aria-expanded={expanded}
          aria-controls={filesId}
          onClick={() => setExpanded((current) => !current)}
        >
          <ActivityChevron />
          <span className="dvx-review-dock-count">{count}</span>
          {changes.writing === true ? (
            <span className="dvx-review-dock-writing" role="status">
              <span aria-hidden="true" />
              writing
            </span>
          ) : null}
        </button>
        <div className="dvx-review-dock-actions">
          {branchDiff?.unavailableReason === "unsupported-runtime" ? null : (
            <button
              type="button"
              className="dvx-review-dock-branch-toggle"
              aria-pressed={branchView}
              title="Everything this branch changed against its base"
              onClick={() => {
                setBranchView((current) => !current);
                setExpanded(true);
                onRequestBranchDiff();
              }}
            >
              Branch
            </button>
          )}
          <ChangesCommitEntry key={changes.turnId} turnId={changes.turnId} />
          <button
            type="button"
            className="dvx-review-dock-review"
            title="Open the diff of every changed file"
            onClick={reviewAll}
          >
            Review
          </button>
        </div>
      </div>
      {branch.mounted ? (
        <div
          className="dvx-review-dock-body dvx-review-dock-branch"
          data-open={branch.open ? "true" : "false"}
          aria-hidden={!showBranch}
        >
          <div className="dvx-review-dock-body-inner">
            <BranchBody diff={branchDiff} onOpenFile={onOpenFile} />
          </div>
        </div>
      ) : null}
      {files.mounted ? (
        <div
          className="dvx-review-dock-body"
          id={filesId}
          data-open={files.open ? "true" : "false"}
          aria-hidden={!showFiles}
        >
          <div className="dvx-review-dock-body-inner">
            <ul className="dvx-review-dock-files">
              {changes.files.map((file) => {
                const hasAdditions = file.additions !== null;
                const hasDeletions = file.deletions !== null;
                return (
                  <li key={file.path} className="dvx-review-dock-row">
                    <span className="dvx-review-dock-path" title={file.path}>
                      {file.path}
                    </span>
                    {hasAdditions || hasDeletions ? (
                      <span className="dvx-review-dock-stats">
                        {hasAdditions ? (
                          <span className="dvx-changes-add">
                            +{file.additions}
                          </span>
                        ) : null}
                        {hasAdditions && hasDeletions ? (
                          <span aria-hidden="true">/</span>
                        ) : null}
                        {hasDeletions ? (
                          <span className="dvx-changes-del">
                            −{file.deletions}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="dvx-review-dock-file-action"
                      title={`Open changes for ${file.path}`}
                      onClick={() =>
                        onOpenFileDiff(file.path, changes.turnId)
                      }
                    >
                      Diff
                    </button>
                    {isPreviewableFilePath(file.path) ? (
                      <button
                        type="button"
                        className="dvx-review-dock-file-action"
                        title={`Open ${file.path} in Canvas`}
                        onClick={() => onPreviewFile(file.path)}
                      >
                        Canvas
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Branch-scope counterpart of the turn list: every file this branch
 * changed against its base, committed or not. Rows open the file
 * itself; no turn owns them, so no turn baseline could frame a diff.
 * The caller supplies the animated `.dvx-review-dock-body` shell, so
 * this renders only the inner content.
 */
function BranchBody({
  diff,
  onOpenFile,
}: {
  readonly diff: GitBranchDiffState | null;
  readonly onOpenFile: (path: string) => void;
}): React.JSX.Element {
  if (diff === null) {
    return (
      <div className="dvx-review-dock-branch-note" role="status">
        Reading branch…
      </div>
    );
  }
  if (diff.unavailableReason !== undefined) {
    return (
      <div className="dvx-review-dock-branch-note" role="status">
        Branch changes are unavailable for this session.
      </div>
    );
  }
  return (
    <>
      <div className="dvx-review-dock-branch-head">
        <span className="dvx-review-dock-branch-name">
          {diff.branch} vs {diff.baseBranch}
        </span>
        <span className="dvx-review-dock-stats">
          <span className="dvx-changes-add">+{diff.additions}</span>
          <span aria-hidden="true">/</span>
          <span className="dvx-changes-del">−{diff.deletions}</span>
        </span>
        <span className="dvx-review-dock-branch-commits">
          {diff.commitCount} {diff.commitCount === 1 ? "commit" : "commits"}
        </span>
      </div>
      {diff.files.length === 0 ? (
        <div className="dvx-review-dock-branch-note">
          No files differ from the base branch.
        </div>
      ) : (
        <ul className="dvx-review-dock-files">
          {diff.files.map((file) => (
            <li key={file.path} className="dvx-review-dock-row">
              <span className="dvx-review-dock-path" title={file.path}>
                {file.path}
              </span>
              <span className="dvx-review-dock-stats">
                <span className="dvx-changes-add">+{file.additions}</span>
                <span aria-hidden="true">/</span>
                <span className="dvx-changes-del">−{file.deletions}</span>
              </span>
              <button
                type="button"
                className="dvx-review-dock-file-action"
                title={`Open ${file.path}`}
                onClick={() => onOpenFile(file.path)}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
