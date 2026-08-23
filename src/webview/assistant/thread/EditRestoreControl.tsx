// Edit card's file-restore option: a small collapsed dock rendered
// as its own sibling card below the edit card (2026-08-19 layout
// feedback — not nested inside it, the same "own card, own border"
// treatment the bottom Review dock and PlanLine already use).
// Reuses the Review dock's card chrome and row list instead of the
// composer's floating popovers — an inline expand cannot clip or
// overlap the transcript the way a positioned popover did.

import { useId, useState } from "react";

import { ActivityChevron } from "./icons";
import { useDeferredDisclosure } from "../useDeferredDisclosure";

interface EditRestorePath {
  readonly path: string;
  readonly created: boolean;
}

interface EditRestoreEvicted {
  readonly path: string;
  readonly reason: string;
}

export function EditRestoreControl({
  affectedFiles,
  affectedPaths,
  evictedFiles,
  restoreFiles,
  onRestoreFilesChange,
}: {
  readonly affectedFiles: number;
  readonly affectedPaths: readonly EditRestorePath[];
  readonly evictedFiles: readonly EditRestoreEvicted[];
  readonly restoreFiles: boolean;
  readonly onRestoreFilesChange: (value: boolean) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  // Mounts once the reader opens it, then stays mounted (collapsed
  // via CSS) so both directions animate — same technique as the
  // bottom Review dock's file list (29-review-dock.css).
  const restore = useDeferredDisclosure(expanded);
  const filesId = useId();

  if (affectedFiles === 0 && evictedFiles.length === 0) {
    return null;
  }

  // Nothing here is restorable, only files a rewind cannot touch: a
  // lone status line, no checkbox and no dock chrome to expand.
  if (affectedFiles === 0) {
    return (
      <div
        className="dvx-restore-evicted"
        role="status"
        title={evictedFiles
          .map((file) => `${file.path} — ${file.reason}`)
          .join("\n")}
      >
        {evictedFiles.length}{" "}
        {evictedFiles.length === 1 ? "file" : "files"} cannot be restored
      </div>
    );
  }

  return (
    <section className="dvx-restore-dock">
      <div className="dvx-restore-dock-head">
        <label
          className="dvx-user-edit-restore"
          title={`Resending rewinds the conversation to this message. Also restore the ${affectedFiles} workspace ${
            affectedFiles === 1 ? "file" : "files"
          } Droid changed after it.`}
        >
          <input
            type="checkbox"
            className="dvx-restore-input"
            checked={restoreFiles}
            onChange={(event) =>
              onRestoreFilesChange(event.currentTarget.checked)
            }
          />
          <span className="dvx-restore-box" aria-hidden="true">
            <svg viewBox="0 0 10 10" fill="none">
              <path
                d="m2 5.2 2.2 2.2L8 3.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="dvx-restore-copy">
            Restore {affectedFiles} {affectedFiles === 1 ? "file" : "files"}{" "}
            changed after this point
          </span>
        </label>
        <button
          type="button"
          className="dvx-review-dock-toggle"
          aria-label="Restorable files"
          aria-expanded={expanded}
          aria-controls={filesId}
          onClick={() => setExpanded((current) => !current)}
        >
          <ActivityChevron />
        </button>
      </div>
      {restore.mounted ? (
        <div
          className="dvx-review-dock-body"
          id={filesId}
          data-open={restore.open ? "true" : "false"}
          aria-hidden={!expanded}
        >
          <div className="dvx-review-dock-body-inner">
            <ul className="dvx-review-dock-files">
              {affectedPaths.map(({ path, created }) => (
                <li
                  key={`${created ? "c" : "r"}:${path}`}
                  className="dvx-review-dock-row"
                  title={
                    created
                      ? `${path} — created after this point; restoring deletes it`
                      : `${path} — restored to its contents at this point`
                  }
                >
                  <span className="dvx-review-dock-path">{path}</span>
                  {created ? (
                    <span className="dvx-restore-file-tag">new</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {evictedFiles.length > 0 ? (
              <div
                className="dvx-restore-evicted"
                role="status"
                title={evictedFiles
                  .map((file) => `${file.path} — ${file.reason}`)
                  .join("\n")}
              >
                {evictedFiles.length}{" "}
                {evictedFiles.length === 1 ? "file" : "files"} cannot be
                restored
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
