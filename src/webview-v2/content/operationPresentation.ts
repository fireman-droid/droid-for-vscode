import type { OperationDiff, ToolExecutionPhase } from '../../shared/protocol/operationDiff';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';

export function operationLabel(diff: OperationDiff): string {
  if (diff.status !== 'ready') return 'Operation evidence unavailable';
  if (diff.source === 'tool-input') return 'Proposed edits · not confirmed';
  if (diff.source === 'successful-tool-input') return 'Legacy input excerpt · execution changes unverified';
  return diff.files.some((file) => file.outcome !== 'applied')
    ? 'Tool results · partial or unconfirmed changes' : 'Confirmed tool operations';
}

const phases: Record<ToolExecutionPhase, string> = {
  streaming_input: 'Preparing input', queued: 'Waiting to execute', executing: 'Executing',
  settled_after_execution: 'Execution finished', settled_without_execution: 'Not executed',
  settled_unknown: 'Execution state unknown',
};
export function executionLabel(item: ToolTranscriptItem): string | undefined {
  if (item.executionPhase === 'settled_without_execution') return phases[item.executionPhase];
  return item.status === 'running' && item.executionPhase ? phases[item.executionPhase] : undefined;
}
