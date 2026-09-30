import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
export interface ToolResultSummary {
  readonly kind: 'diagnostics';
  readonly totalCount: number;
  readonly filteredCount: number;
}
export function isToolResultSummary(value: unknown): value is ToolResultSummary {
  return isStrictRecord(value) && hasExactKeys(value, ['kind', 'totalCount', 'filteredCount']) &&
    value.kind === 'diagnostics' && Number.isSafeInteger(value.totalCount) &&
    Number.isSafeInteger(value.filteredCount) && (value.filteredCount as number) >= 0 &&
    (value.totalCount as number) >= (value.filteredCount as number);
}
export function toolResultSummaryLabel(summary: ToolResultSummary): string {
  if (summary.totalCount === 0) return 'No diagnostics reported';
  if (summary.filteredCount !== summary.totalCount)
    return summary.filteredCount + ' matching · ' + summary.totalCount + ' total diagnostics';
  return summary.totalCount + (summary.totalCount === 1 ? ' diagnostic reported' : ' diagnostics reported');
}
