import { useAuiState } from '@assistant-ui/react';
import { useContext, useId, useMemo, type ReactNode } from 'react';
import type { GroupCandidatePart } from '../activityGrouping';
import { presentActivity } from '../activityPresentation';
import {
  ProcessGroupContext,
  ProcessWaitingContext,
  useProcessDisclosure,
} from '../processPresentation';
import { ActivityChevron } from '../../thread/icons';

export function ActivityGroup({
  indices,
  children,
}: {
  readonly indices: readonly number[];
  readonly children: ReactNode;
}): React.JSX.Element {
  const parts = useAuiState((s) => s.message.parts);
  const messageId = useAuiState((s) => s.message.id);
  const turnId = useAuiState((s) =>
    typeof s.message.metadata.custom?.turnId === 'string'
      ? s.message.metadata.custom.turnId
      : null,
  );
  const messageRunning = useAuiState((s) => s.message.status?.type === 'running');
  const incomplete = useAuiState((s) =>
    s.message.status?.type === 'incomplete' ? s.message.status.reason : null,
  );
  const waiting = useContext(ProcessWaitingContext);
  const members = useMemo(
    () =>
      indices.flatMap((index) =>
        parts[index] === undefined ? [] : ([parts[index]!] as GroupCandidatePart[]),
      ),
    [parts, indices],
  );
  const tail = (indices.at(-1) ?? -1) === parts.length - 1;
  const presentation = useMemo(
    () => presentActivity({ members, messageRunning, tail, incomplete, turnId, waiting }),
    [members, messageRunning, tail, incomplete, turnId, waiting],
  );
  const { running, action, target, facts, failed } = presentation;
  const { expanded, mounted, visible, toggle, buttonRef, contentRef } =
    useProcessDisclosure(messageId, indices[0]);
  const detailsId = useId();
  return (
    <div className={`dvx-activity-group${running ? ' dvx-activity-group-running' : ''}`}>
      <button
        type="button"
        ref={buttonRef}
        className={`dvx-activity-group-summary${running ? '' : ' dvx-activity-group-summary-completed'}`}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={toggle}
      >
        <ActivityChevron />
        <span className="dvx-activity-group-main">
          <span className="dvx-activity-group-title">
            {running ? (
              <span className="dvx-activity-group-running-dot" aria-hidden="true" />
            ) : null}
            <span>Activity</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="dvx-activity-group-current">{action}</span>
          {target === null ? null : (
            <span className="dvx-activity-group-current-target" title={target}>
              {target}
            </span>
          )}
        </span>
        {facts.length === 0 ? null : (
          <span
            className={`dvx-activity-state${failed ? ' dvx-activity-state-failed' : ''}`}
          >
            {facts.join(' · ')}
          </span>
        )}
      </button>
      <div
        id={detailsId}
        ref={contentRef}
        className={`dvx-activity-group-details${visible ? ' dvx-activity-group-details-open' : ''}`}
        aria-hidden={!expanded}
        inert={expanded ? undefined : true}
      >
        <div className="dvx-activity-group-details-inner">
          {mounted ? (
            <ProcessGroupContext.Provider value={true}>
              {children}
            </ProcessGroupContext.Provider>
          ) : null}
        </div>
      </div>
    </div>
  );
}
