export const FILE_NOT_READY_DIAGNOSTIC_CODE = 'file-not-ready';
export const STOP_UNCONFIRMED_DIAGNOSTIC_CODE = 'turn-stop-unconfirmed';
type SubagentEvidenceDiagnosticCode = `subagent-operation-evidence-${
  'mapping-missing' | 'mapping-ambiguous' | 'history-unavailable' | 'history-partial'}`;
export type TransientDiagnosticCode = typeof FILE_NOT_READY_DIAGNOSTIC_CODE |
  typeof STOP_UNCONFIRMED_DIAGNOSTIC_CODE | SubagentEvidenceDiagnosticCode;

/**
 * Runtime diagnostics that are immediate interaction feedback rather
 * than session history. Host recovery and the webview transcript must
 * both exclude them so the notice cannot outlive the active action.
 */
export function isTransientRuntimeDiagnostic(
  code: string,
): code is TransientDiagnosticCode {
  return code === FILE_NOT_READY_DIAGNOSTIC_CODE || code === STOP_UNCONFIRMED_DIAGNOSTIC_CODE ||
    // Recomputed in Review from the current ledger/history; an old loading gap
    // must not survive recovery as a permanent chat error.
    code === 'subagent-operation-evidence-mapping-missing' ||
    code === 'subagent-operation-evidence-mapping-ambiguous' ||
    code === 'subagent-operation-evidence-history-unavailable' ||
    code === 'subagent-operation-evidence-history-partial';
}
