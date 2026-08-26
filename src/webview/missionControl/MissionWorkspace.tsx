import { useMemo } from 'react';

import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../shared/missionControlPanelProtocol';
import {
  MISSION_BRIDGE_PROTOCOL_VERSION,
  type MissionControlResultMessage,
  type MissionSnapshotMessage,
  type MissionStartMessage,
} from '../../shared/missionProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../shared/missionControlSetupProtocol';
import { MissionSetup } from '../assistant/mission/MissionSetup';
import type { MissionSetupSubmission } from '../assistant/mission/missionStart';
import {
  useMissionControl,
  type MissionUiCommand,
} from '../assistant/mission/useMissionControl';

interface MissionPort {
  postMessage(message: unknown): void;
}

export function MissionWorkspace({
  route,
  setup,
  mission,
  result,
  vscode,
  onCatalog,
  onClose,
}: {
  readonly route: 'new-mission' | 'detail';
  readonly setup: MissionControlSetupSnapshotMessage | null;
  readonly mission: MissionSnapshotMessage | null;
  readonly result: MissionControlResultMessage | null;
  readonly vscode: MissionPort;
  readonly onCatalog: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <aside
      className="dvx-btw-panel mission-inspector"
      role="complementary"
      aria-label={route === 'new-mission' ? 'Mission setup' : 'Mission details'}
    >
      {route === 'new-mission' ? (
        <SetupInspector
          snapshot={setup}
          result={result}
          vscode={vscode}
          onCatalog={onCatalog}
          onClose={onClose}
        />
      ) : (
        <MissionInspector
          snapshot={mission}
          vscode={vscode}
          onCatalog={onCatalog}
          onClose={onClose}
        />
      )}
    </aside>
  );
}

function SetupInspector({
  snapshot,
  result,
  vscode,
  onCatalog,
  onClose,
}: {
  readonly snapshot: MissionControlSetupSnapshotMessage | null;
  readonly result: MissionControlResultMessage | null;
  readonly vscode: MissionPort;
  readonly onCatalog: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const capabilities = snapshot?.capabilities ?? null;
  const setupResult =
    result?.action === 'start'
      ? {
          requestId: result.requestId,
          status: result.status,
        }
      : null;
  const status = snapshot === null
    ? 'Loading Mission setup…'
    : describeSetupStatus(snapshot);

  const start = (submission: MissionSetupSubmission): string | null => {
    if (snapshot?.availability !== 'ready') {
      return null;
    }
    const requestId = createRequestId('mission-start');
    const message: MissionStartMessage = {
      type: 'mission.start',
      protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
      requestId,
      scope: 'selected-chat',
      ...submission,
    };
    vscode.postMessage(message);
    return requestId;
  };

  return (
    <>
      <InspectorHeader
        title="New Mission"
        hint="Review the outcome and execution roles."
        onCatalog={onCatalog}
        backDisabled={snapshot?.phase === 'starting'}
      />
      <p className="mission-inspector-status" role="status" aria-live="polite">
        {status}
      </p>
      {snapshot?.phase === 'advisory' && snapshot.readiness !== null ? (
        <section className="mission-readiness-advisory" role="alert">
          <strong>Repository readiness warning</strong>
          <p>{describeReadinessWarning(snapshot.readiness.warning)}</p>
          <button
            type="button"
            onClick={() => {
              vscode.postMessage({
                type: 'missionControl.setup.continue',
                protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
                requestId: createRequestId('mission-continue'),
                setupRevision: snapshot.setupRevision,
              });
            }}
          >
            Continue anyway
          </button>
        </section>
      ) : null}
      <div className="mission-inspector-scroll">
        {capabilities === null ? (
          <p className="mission-inspector-empty">
            Mission setup is waiting for an available chat and model catalog.
          </p>
        ) : (
          <MissionSetup
            capabilities={capabilities}
            initialTask={snapshot?.draft.task ?? ''}
            onStart={start}
            onDismiss={onClose}
            result={setupResult}
            startDisabled={
              snapshot?.availability !== 'ready' ||
              (snapshot.phase !== 'draft' &&
                snapshot.phase !== 'indeterminate')
            }
          />
        )}
      </div>
    </>
  );
}

function MissionInspector({
  snapshot,
  vscode,
  onCatalog,
  onClose,
}: {
  readonly snapshot: MissionSnapshotMessage | null;
  readonly vscode: MissionPort;
  readonly onCatalog: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const command = useMissionControl(vscode as never, () =>
    createRequestId('mission-control'),
  );
  const total = snapshot?.features.length ?? 0;
  const completed = snapshot?.completedFeatureCount ?? 0;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
  const features = useMemo(
    () => snapshot?.features ?? [],
    [snapshot?.features],
  );

  return (
    <>
      <InspectorHeader
        title={snapshot?.title ?? 'Mission'}
        hint={snapshot === null ? 'Loading Mission state…' : formatPhase(snapshot)}
        onCatalog={onCatalog}
        onClose={onClose}
      />
      <div className="mission-inspector-scroll">
        {snapshot === null ? (
          <p className="mission-inspector-empty">Loading Mission details…</p>
        ) : (
          <>
            <section className="mission-progress-card" aria-label="Mission progress">
              <div>
                <span>Progress</span>
                <strong>{completed} of {total}</strong>
              </div>
              <div
                className="mission-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={completed}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
            </section>
            <MissionActions snapshot={snapshot} onCommand={command} />
            <section className="mission-feature-section">
              <h2>Features</h2>
              {features.length === 0 ? (
                <p className="mission-inspector-empty">
                  Droid has not published the feature plan yet.
                </p>
              ) : (
                <ol className="mission-feature-list">
                  {features.map((feature) => (
                    <li
                      key={feature.id}
                      data-active={feature.id === snapshot.currentFeatureId}
                    >
                      <span className="mission-feature-index">
                        {feature.order + 1}
                      </span>
                      <span className="mission-feature-copy">
                        <strong>{feature.title}</strong>
                        <small>{formatFeatureStatus(feature.status)}</small>
                      </span>
                      {feature.workerViewAvailable ? (
                        <button
                          type="button"
                          onClick={() =>
                            command({
                              type: 'mission.viewer.open',
                              revision: snapshot.revision,
                              featureId: feature.id,
                            })
                          }
                        >
                          View
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="mission-validator">
              <h2>Validation</h2>
              <dl>
                <div>
                  <dt>Scrutiny</dt>
                  <dd>{snapshot.validator.scrutinyEnabled ? 'On' : 'Off'}</dd>
                </div>
                <div>
                  <dt>User testing</dt>
                  <dd>{snapshot.validator.userTestingEnabled ? 'On' : 'Off'}</dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function InspectorHeader({
  title,
  hint,
  onCatalog,
  onClose,
  backDisabled = false,
}: {
  readonly title: string;
  readonly hint: string;
  readonly onCatalog: () => void;
  readonly onClose?: () => void;
  readonly backDisabled?: boolean;
}): React.JSX.Element {
  return (
    <header className="dvx-btw-header mission-inspector-header">
      <div>
        <button
          type="button"
          className="mission-inspector-back"
          disabled={backDisabled}
          onClick={onCatalog}
        >
          Missions
        </button>
        <span className="dvx-btw-title">{title}</span>
        <small>{hint}</small>
      </div>
      {onClose === undefined ? null : (
        <button
          type="button"
          className="dvx-btw-close"
          aria-label="Close Mission"
          onClick={onClose}
        >
          ×
        </button>
      )}
    </header>
  );
}

function MissionActions({
  snapshot,
  onCommand,
}: {
  readonly snapshot: MissionSnapshotMessage;
  readonly onCommand: (command: MissionUiCommand) => void;
}): React.JSX.Element | null {
  const busy = snapshot.controls.busyAction !== undefined;
  if (
    !snapshot.controls.canPause &&
    !snapshot.controls.canResume &&
    !snapshot.controls.canStopCurrentFeature &&
    !busy
  ) {
    return null;
  }
  return (
    <div className="mission-action-row" aria-label="Mission controls">
      {snapshot.controls.canPause ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCommand({ type: 'mission.pause', revision: snapshot.revision })
          }
        >
          Pause activity
        </button>
      ) : null}
      {snapshot.controls.canResume ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCommand({ type: 'mission.resume', revision: snapshot.revision })
          }
        >
          Resume Mission
        </button>
      ) : null}
      {snapshot.controls.canStopCurrentFeature ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCommand({
              type: 'mission.stopCurrentFeature',
              revision: snapshot.revision,
            })
          }
        >
          Stop feature
        </button>
      ) : null}
      {busy ? <span role="status">Updating…</span> : null}
    </div>
  );
}

function describeSetupStatus(
  snapshot: MissionControlSetupSnapshotMessage,
): string {
  if (snapshot.phase === 'inspecting') {
    return 'Inspecting repository readiness…';
  }
  if (snapshot.phase === 'advisory') {
    return 'Review the repository warning before continuing.';
  }
  if (snapshot.phase === 'starting') {
    return 'Starting Mission…';
  }
  if (snapshot.phase === 'indeterminate') {
    return 'Readiness could not be confirmed. Retry when ready.';
  }
  if (snapshot.availability === 'ready') {
    return 'Ready to inspect repository readiness and start.';
  }
  if (snapshot.availability === 'busy') {
    return 'Finish the current chat activity before starting.';
  }
  if (snapshot.availability === 'loading') {
    return 'Loading the selected chat setup…';
  }
  if (snapshot.availability === 'error') {
    return 'Mission setup could not be loaded.';
  }
  return 'Select an available chat and trusted workspace to continue.';
}

function describeReadinessWarning(
  warning: NonNullable<
    MissionControlSetupSnapshotMessage['readiness']
  >['warning'],
): string {
  switch (warning) {
    case 'no_git':
      return 'This workspace is not a Git repository.';
    case 'no_remote':
      return 'This repository has no configured remote.';
    case 'no_report':
      return 'No Agent Readiness report is available for this repository.';
    case 'low_score':
      return 'The latest Agent Readiness score is below the recommended level.';
  }
}

function formatPhase(snapshot: MissionSnapshotMessage): string {
  if (snapshot.availability === 'detached') return 'Detached';
  if (snapshot.lifecycle === undefined) return 'Loading Mission state…';
  if (snapshot.lifecycle === 'awaiting_input') return 'Awaiting input';
  if (snapshot.lifecycle === 'orchestrator_turn') return 'Orchestrating';
  return snapshot.lifecycle[0]!.toUpperCase() + snapshot.lifecycle.slice(1);
}

function formatFeatureStatus(
  status: MissionSnapshotMessage['features'][number]['status'],
): string {
  if (status === 'in_progress') return 'In progress';
  return status[0]!.toUpperCase() + status.slice(1);
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
