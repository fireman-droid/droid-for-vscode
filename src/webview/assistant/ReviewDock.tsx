import { useEffect, useId, useState } from "react";

import type { ChangesTranscriptItem } from "../../shared/bridgeMessages";
import { isPreviewableFilePath } from "../../shared/validateMessage";
import { ChangesCommitEntry } from "./GitCommitPanel";
import { ActivityChevron } from "./thread/icons";

interface ReviewDockProps {
  readonly changes: ChangesTranscriptItem;
  readonly onOpenFileDiff: (
    path: string,
    turnId: string | null,
  ) => void;
  readonly onPreviewFile: (path: string) => void;
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
  deferMount = false,
}: ReviewDockProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
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
      {expanded ? (
        <div className="dvx-review-dock-body" id={filesId}>
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
      ) : null}
    </section>
  );
}
