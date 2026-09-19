import { useState } from 'react';

import type { MissionSnapshotMessage } from '../../../shared/protocol/missionProtocol';
import type { MissionUiCommand } from './useMissionControl';

export function MissionControl({
  snapshot,
  onCommand,
}: {
  readonly snapshot: MissionSnapshotMessage;
  readonly onCommand: (command: MissionUiCommand) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const total = snapshot.features.length;
  const completed = snapshot.completedFeatureCount;
  const phase =
    snapshot.availability === 'detached'
      ? 'Detached'
      : formatPhase(snapshot.lifecycle, snapshot.presentationPhase);
  const busy = snapshot.controls.busyAction;
  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    onCommand({ type: 'mission.disclosure.set', expanded: next });
  };
  return (
    <section className="dvx-mission-control" aria-label="Mission control">
      <button
        type="button"
        className="dvx-mission-control-head"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <span>
          <strong>{snapshot.title ?? 'Mission'}</strong>
          <small>{`${phase} · ${completed}/${total} features`}</small>
        </span>
        <span aria-hidden="true" className="dvx-mission-chevron">
          ›
        </span>
      </button>
      {expanded ? (
        <div className="dvx-mission-control-body">
          <div
            className="dvx-mission-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
          >
            <span
              style={{
                width: total === 0 ? '0%' : `${(completed / total) * 100}%`,
              }}
            />
          </div>
          <div className="dvx-mission-control-actions">
            {snapshot.controls.canPause ? (
              <ControlButton
                label="Pause activity"
                onClick={() =>
                  onCommand({
                    type: 'mission.pause',
                    revision: snapshot.revision,
                  })
                }
              />
            ) : null}
            {snapshot.controls.canResume ? (
              <ControlButton
                label="Resume"
                onClick={() =>
                  onCommand({
                    type: 'mission.resume',
                    revision: snapshot.revision,
                  })
                }
              />
            ) : null}
            {snapshot.controls.canStopCurrentFeature ? (
              <ControlButton
                label="Stop current feature"
                onClick={() =>
                  onCommand({
                    type: 'mission.stopCurrentFeature',
                    revision: snapshot.revision,
                  })
                }
              />
            ) : null}
            {busy === undefined ? null : (
              <span role="status" className="dvx-mission-busy">
                {`${formatBusy(busy)}…`}
              </span>
            )}
            <ControlButton
              label="Open Mission Control"
              onClick={() => onCommand({ type: 'mission.panel.open' })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ControlButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function formatPhase(
  lifecycle: MissionSnapshotMessage['lifecycle'],
  presentation: MissionSnapshotMessage['presentationPhase'],
): string {
  if (lifecycle === undefined) {
    return presentation === 'setup' ? 'Setup' : 'Loading';
  }
  switch (lifecycle) {
    case 'awaiting_input':
      return 'Awaiting input';
    case 'orchestrator_turn':
      return 'Orchestrating';
    case 'running':
      return 'Running';
    default:
      return lifecycle[0]!.toUpperCase() + lifecycle.slice(1);
  }
}

function formatBusy(
  action: NonNullable<MissionSnapshotMessage['controls']['busyAction']>,
): string {
  switch (action) {
    case 'pause':
      return 'Pausing';
    case 'resume':
      return 'Resuming';
    case 'stop':
      return 'Stopping feature';
  }
}
