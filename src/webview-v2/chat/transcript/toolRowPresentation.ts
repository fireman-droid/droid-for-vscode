import type { ResultUnavailableReason } from '../../../shared/transcript/toolResultPreview';

export const RESULT_UNAVAILABLE_COPY: Record<ResultUnavailableReason, { label: string; detail: string }> = {
  empty: { label: 'No text', detail: 'The tool returned no displayable text.' },
  'not-saved': { label: 'Not saved', detail: 'This record does not contain a result snippet.' },
  evicted: { label: 'Not retained', detail: 'The conversation limit removed this result snippet.' },
  restricted: {
    label: 'No preview',
    detail: 'This result preview is restricted. The tool’s execution status is shown separately.',
  },
  'outside-workspace': { label: 'External result', detail: 'The tool targeted a location outside the workspace. Its result preview is not retained.' },
  unsupported: { label: 'No preview', detail: 'This result format does not support text snippets.' },
  untrusted: { label: 'No preview', detail: 'The result source could not be verified.' },
};

export function canPreviewToolDiff(toolName: string, status: string, filePath: string | null | undefined, turnId: string | null): boolean {
  return filePath != null && turnId !== null && status === 'completed' &&
    ['applypatch', 'create', 'edit', 'write'].includes(toolName.toLowerCase());
}
