import { useEffect, useState } from 'react';

import type {
  MissionControlSetupDraft,
  MissionControlSetupSnapshotMessage,
} from '../../shared/protocol/missionControlSetupProtocol';
import { MAX_MISSION_TASK_LENGTH } from '../../shared/protocol/missionProtocol';

interface NewMissionDraftProps {
  readonly snapshot: MissionControlSetupSnapshotMessage | null;
  readonly onBack: () => void;
  readonly onUpdate: (draft: MissionControlSetupDraft) => void;
}

export function NewMissionDraft({
  snapshot,
  onBack,
  onUpdate,
}: NewMissionDraftProps): React.JSX.Element {
  const [draft, setDraft] = useState(snapshot?.draft ?? null);
  useEffect(() => {
    setDraft(snapshot?.draft ?? null);
  }, [snapshot?.setupRevision]);

  const status = snapshot === null ? null : describeAvailability(snapshot);
  return (
    <main className="mission-control-page mission-control-route mission-new">
      <button type="button" className="mission-control-back" onClick={onBack}>
        Back to Missions
      </button>
      <header className="mission-new-header">
        <p className="mission-new-kicker">New Mission</p>
        <h1 tabIndex={-1}>Shape the work before it starts</h1>
        <p>
          Review the task and inherited roles here. Nothing starts from this screen yet.
        </p>
      </header>
      {draft === null ? (
        <p role="status" className="mission-new-status">
          Loading the selected chat setup…
        </p>
      ) : (
        <section className="mission-new-sheet" aria-label="Mission draft">
          <label className="mission-new-task">
            <span>Task</span>
            <textarea
              rows={7}
              maxLength={MAX_MISSION_TASK_LENGTH}
              value={draft.task}
              placeholder="Describe the outcome, constraints, and acceptance criteria."
              onChange={(event) => {
                setDraft({ ...draft, task: event.currentTarget.value });
              }}
              onBlur={() => onUpdate(draft)}
            />
          </label>
          <div className="mission-new-roles" aria-label="Mission roles">
            <RoleRow label="Orchestrator" profile={draft.orchestrator} />
            <RoleRow label="Worker" profile={draft.worker} />
            <RoleRow label="Validator" profile={draft.validator} />
          </div>
          <p
            role="status"
            aria-label="Mission setup status"
            className="mission-new-status"
          >
            {status}
          </p>
        </section>
      )}
    </main>
  );
}

function RoleRow({
  label,
  profile,
}: {
  readonly label: string;
  readonly profile:
    | MissionControlSetupDraft['orchestrator']
    | MissionControlSetupDraft['worker'];
}): React.JSX.Element {
  return (
    <div className="mission-new-role">
      <span>{label}</span>
      <strong>
        {profile === null
          ? 'Waiting for selected chat'
          : `${profile.modelId} · ${profile.reasoningEffort}`}
      </strong>
    </div>
  );
}

function describeAvailability(snapshot: MissionControlSetupSnapshotMessage): string {
  if (snapshot.availability === 'ready') {
    return 'Setup is ready for review.';
  }
  if (snapshot.availability === 'busy') {
    return 'The selected chat is busy. Your draft is preserved.';
  }
  if (snapshot.availability === 'loading') {
    return 'Refreshing setup authority. Your draft is preserved.';
  }
  if (snapshot.availability === 'error') {
    return 'Setup authority could not be refreshed. Your draft is preserved.';
  }
  return 'Select an available chat and workspace to continue. Your draft is preserved.';
}
