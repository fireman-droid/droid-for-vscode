import { useCallback } from "react";

import type {
  ChangesTranscriptItem,
  GitBranchDiffState,
  WebviewToHostMessage,
} from "../../shared/bridgeMessages";
import type { PathLink } from "./pathLink";
import { ReviewDock } from "./ReviewDock";

interface MessagePoster {
  postMessage(message: WebviewToHostMessage): void;
}

/**
 * Wires the viewport-footer Review dock to the Bridge. Rendering it
 * needs a latest-changes card and a connected session; `sessionId` is
 * null whenever either is missing.
 */
export function ReviewDockSlot({
  changes,
  sessionId,
  vscode,
  branchDiff,
  onOpenFileDiff,
  onPreviewFile,
  onOpenPath,
}: {
  readonly changes: ChangesTranscriptItem | null;
  readonly sessionId: string | null;
  readonly vscode: MessagePoster;
  readonly branchDiff: GitBranchDiffState | null;
  readonly onOpenFileDiff: (path: string, turnId: string | null) => void;
  readonly onPreviewFile: (path: string) => void;
  readonly onOpenPath: (link: PathLink) => void;
}): React.JSX.Element | null {
  const requestBranchDiff = useCallback((): void => {
    if (sessionId !== null) {
      vscode.postMessage({ type: "git.requestBranchDiff", sessionId });
    }
  }, [sessionId, vscode]);
  const openFile = useCallback(
    (path: string): void => onOpenPath({ path }),
    [onOpenPath],
  );
  if (changes === null || changes.files.length === 0) {
    return null;
  }
  return (
    <ReviewDock
      key={`${sessionId ?? "none"}:${changes.turnId}`}
      changes={changes}
      onOpenFileDiff={onOpenFileDiff}
      onPreviewFile={onPreviewFile}
      branchDiff={branchDiff}
      onRequestBranchDiff={requestBranchDiff}
      onOpenFile={openFile}
      deferMount
    />
  );
}
