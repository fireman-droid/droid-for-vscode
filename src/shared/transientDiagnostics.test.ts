import { describe, expect, it } from 'vitest';

import {
  FILE_NOT_READY_DIAGNOSTIC_CODE,
  isTransientRuntimeDiagnostic,
} from './transientDiagnostics';

describe('transient diagnostics', () => {
  it('limits ephemeral treatment to file-not-ready feedback', () => {
    expect(
      isTransientRuntimeDiagnostic(FILE_NOT_READY_DIAGNOSTIC_CODE),
    ).toBe(true);
    expect(isTransientRuntimeDiagnostic('file-diff-failed')).toBe(
      false,
    );
  });
});
