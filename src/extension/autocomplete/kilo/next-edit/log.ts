/** Instance-scoped diagnostics; never carries document text or provider credentials. */
export interface NextEditDiagnostic {
  name: 'accepted' | 'discarded' | 'dismissed' | 'jumped' | 'apply-failed';
  attributes: Record<string, string | number | boolean>;
}
