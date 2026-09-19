import {
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
} from '../../../shared/protocol/gitCommitFlow';
import { GIT_FILE_STATUS_LABELS as FILE_STATUS_LABELS, useGitCommitDraft, useGitCommitEntry, type GitCommitFlowContextValue } from './gitCommitFlow';
export { GitCommitFlowContext, type GitCommitFlowContextValue } from './gitCommitFlow';

/**
 * Inline commit panel behind the quiet entry at the tail of the
 * latest changes card (slice A of the git/PR workflow design). All
 * Bridge traffic flows through the context callbacks that App wires
 * up, so the memoized message tree stays free of prop drilling —
 * same pattern as Thread's FileDiffContext.
 */

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
  const entry = useGitCommitEntry(turnId);
  if (entry.kind === 'hidden') return null;
  if (entry.kind === 'notice') return <div className="dvx-commit-result" role="status">{entry.text}</div>;
  if (entry.kind === 'button') {
    return (
      <button
        type="button"
        className="dvx-changes-action dvx-changes-commit"
        onClick={entry.open}
      >
        Commit…
      </button>
    );
  }
  return (
    <GitCommitPanel flow={entry.flow} turnId={entry.turnId} onClose={entry.close} />
  );
}

function GitCommitPanel({
  flow,
  turnId,
  onClose,
}: {
  readonly flow: GitCommitFlowContextValue;
  readonly turnId: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { state } = flow;
  const { initialized, selected, message, setMessage, toggle, failure, canCommit } = useGitCommitDraft(flow, turnId);

  let body: React.JSX.Element;
  if (!initialized) {
    body = <div className="dvx-commit-hint">Reading git status…</div>;
  } else if (state.files.length === 0) {
    body = <div className="dvx-commit-hint">No uncommitted changes.</div>;
  } else {
    body = (
      <>
        <div className="dvx-commit-files" role="group" aria-label="Files to commit">
          {state.files.map((file) => (
            <label key={file.path} className="dvx-commit-file">
              <input
                type="checkbox"
                checked={selected.has(file.path)}
                disabled={state.commitPending}
                onChange={() => toggle(file.path)}
              />
              <span className="dvx-commit-file-path" title={file.path}>
                {file.path}
              </span>
              <span className="dvx-commit-file-meta">
                {FILE_STATUS_LABELS[file.status]}
                {file.staged ? ' · staged' : ''}
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
          <button type="button" className="dvx-commit-cancel" onClick={onClose}>
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
            {state.commitPending ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="dvx-commit-panel" role="group" aria-label="Commit changes">
      <div className="dvx-commit-head">
        <span className="dvx-commit-title">Commit</span>
        {state.branch === null ? null : (
          <span className="dvx-commit-branch">on {state.branch}</span>
        )}
      </div>
      {body}
    </div>
  );
}
