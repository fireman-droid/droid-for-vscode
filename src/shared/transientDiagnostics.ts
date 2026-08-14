export const FILE_NOT_READY_DIAGNOSTIC_CODE = 'file-not-ready';

/**
 * Runtime diagnostics that are immediate interaction feedback rather
 * than session history. Host recovery and the webview transcript must
 * both exclude them so the notice cannot outlive the active action.
 */
export function isTransientRuntimeDiagnostic(
  code: string,
): code is typeof FILE_NOT_READY_DIAGNOSTIC_CODE {
  return code === FILE_NOT_READY_DIAGNOSTIC_CODE;
}
