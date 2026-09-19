import { useAuiState } from '@assistant-ui/react';
import { isPreviewableFilePath } from '../../../../shared/validation/guards';
import { PreviewChip, ToolFilePath } from '../../thread/transcriptRows';
import { useContext, useId } from 'react';
import {
  RESULT_TOOLS,
} from '../../../../shared/transcript/toolResultPreview';
import { classifyExploreTool } from '../activityGrouping';
import { OpenPathContext } from '../../markdown/MarkdownText';
import { useProcessDisclosure } from '../processPresentation';
import { ActivityChevron } from '../../thread/icons';
import { formatDuration, type ToolActivityPresentation } from '../../thread/readers';
import { InlineFileDiff } from '../../changes/InlineFileDiff';
import { InlineDiffContext } from '../../changes/useInlineDiff';
import { canPreviewToolDiff, EXPLORE_ACTIONS as ACTIONS, RESULT_UNAVAILABLE_COPY as UNAVAILABLE } from '../toolRowPresentation';

export interface ExplorationToolRowProps {
  readonly activity: ToolActivityPresentation;
  readonly toolName: string;
  readonly toolUseId?: string;
}
export function ExplorationToolRow({
  activity,
  toolName,
  toolUseId,
}: ExplorationToolRowProps): React.JSX.Element {
  const messageId = useAuiState((s) => s.message.id);
  const disclosure = useProcessDisclosure(
    messageId,
    toolUseId === undefined ? undefined : `tool:${toolUseId}`,
  );
  const { expanded, mounted, visible, toggle, buttonRef, contentRef } = disclosure;
  const detailsId = useId();
  const openPath = useContext(OpenPathContext);
  const inlineDiff = useContext(InlineDiffContext);
  const canPreviewDiff = inlineDiff !== null && canPreviewToolDiff(toolName, activity.status, activity.filePath, activity.turnId);
  const preview = activity.resultPreview;
  const available = preview?.availability === 'available' ? preview : null;
  const hasDetails =
    canPreviewDiff || available !== null || Boolean(activity.errorMessage) || Boolean(activity.outputTail);
  const target = activity.filePath ?? activity.target ?? preview?.source?.path;
  const currentFilePath =
    activity.filePath ??
    (available?.source.tool === 'Read' ? available.source.path : null);
  const category = classifyExploreTool(toolName);
  const action = category === null ? activity.action : ACTIONS[category];
  const state =
    activity.status === 'failed'
      ? 'Failed'
      : activity.status === 'stopped'
        ? 'Stopped'
        : activity.status === 'stopping'
          ? 'Stopping'
          : activity.status === 'running'
            ? 'Running'
            : null;
  const unavailable =
    preview?.availability === 'unavailable'
      ? UNAVAILABLE[preview.reason]
      : preview == null &&
          activity.status === 'completed' &&
          !activity.errorMessage &&
          RESULT_TOOLS.some((tool) => tool === toolName)
        ? UNAVAILABLE['not-saved']
        : null;
  const label = (
    <>
      {hasDetails ? <ActivityChevron /> : null}
      <span className="dvx-result-action">{action}</span>
      <span
        className={`dvx-result-target${target ? '' : ' dvx-result-target-missing'}`}
        title={target || 'This record has no displayable target path or query.'}
      >
        {activity.filePath !== null ? (
          <ToolFilePath
            path={activity.filePath}
            turnId={activity.turnId}
            interactive={false}
          />
        ) : (
          target || 'Target not recorded'
        )}
      </span>
      {state ? (
        <span
          className={`dvx-result-state${activity.status === 'failed' ? ' dvx-result-state-failed' : ''}`}
        >
          {state}
        </span>
      ) : null}
      {activity.durationMs === null ? null : (
        <span className="dvx-result-duration">{formatDuration(activity.durationMs)}</span>
      )}
    </>
  );
  return (
    <div className="dvx-result-tool">
      <div className="dvx-result-heading">
        {hasDetails ? (
          <button
            type="button"
            className="dvx-result-summary"
            ref={buttonRef}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={toggle}
          >
            {label}
          </button>
        ) : (
          <div className="dvx-result-summary dvx-result-summary-static">{label}</div>
        )}
        {unavailable === null ? null : (
          <span className="dvx-result-unavailable" title={unavailable.detail}>
            {unavailable.label}
          </span>
        )}
        {currentFilePath !== null && openPath ? (
          <button
            type="button"
            className="dvx-result-open"
            title="Open current file"
            aria-label="Open current file"
            onClick={() => openPath({ path: currentFilePath })}
          >
            Open
          </button>
        ) : null}
        {activity.filePath !== null &&
        activity.status === 'completed' &&
        isPreviewableFilePath(activity.filePath) ? (
          <PreviewChip path={activity.filePath} />
        ) : null}
      </div>
      {hasDetails ? (
        <div
          id={detailsId}
          ref={contentRef}
          className={`dvx-activity-group-details dvx-result-details${visible ? ' dvx-activity-group-details-open' : ''}`}
          aria-hidden={!expanded}
          inert={expanded ? undefined : true}
        >
          <div className="dvx-activity-group-details-inner">
            {mounted ? (
              <div className="dvx-result-content">
                {canPreviewDiff ? (
                  <InlineFileDiff path={activity.filePath!} turnId={activity.turnId!} expanded={expanded} />
                ) : null}
                {available === null ? null : (
                  <>
                    <div className="dvx-result-caption">
                      Result snippet{available.truncated ? ' · truncated' : ''}
                    </div>
                    <pre className="dvx-result-text">{available.text}</pre>
                  </>
                )}
                {activity.outputTail ? (
                  <pre className="dvx-result-text">{activity.outputTail}</pre>
                ) : null}
                {activity.errorMessage ? (
                  <pre className="dvx-result-text dvx-tool-error">
                    {activity.errorMessage}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
