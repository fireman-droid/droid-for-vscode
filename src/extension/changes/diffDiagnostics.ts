import type { RuntimeDiagnosticAttribute } from '../../runtime/runtimeDiagnostics';

/** Metadata only: never persist file contents or a normalized copy. */
export function describeDiffBytes(
  before: Buffer,
  after: Buffer,
): Record<string, RuntimeDiagnosticAttribute> {
  const left = describeBytes(before);
  const right = describeBytes(after);
  return {
    beforeBytes: before.length, afterBytes: after.length,
    beforeText: left.text !== null, afterText: right.text !== null,
    beforeEol: left.eol, afterEol: right.eol,
    beforeCrlf: left.crlf, afterCrlf: right.crlf,
    beforeLf: left.lf, afterLf: right.lf,
    sameBytes: before.equals(after),
    equalIgnoringCrlf: left.text === null || right.text === null ? null :
      left.text.replace(/\r\n/g, '\n') === right.text.replace(/\r\n/g, '\n'),
  };
}

function describeBytes(bytes: Buffer) {
  let text: string | null = null;
  if (!bytes.includes(0)) {
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { /* Non-UTF-8 files have no text equality classification. */ }
  }
  if (text === null) return { text, eol: 'binary', crlf: 0, lf: 0 };
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const cr = (text.match(/\r/g) ?? []).length - crlf;
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0);
  return { text, crlf, lf, eol: kinds > 1 ? 'mixed' : crlf ? 'crlf' : lf ? 'lf' : cr ? 'cr' : 'none' };
}
