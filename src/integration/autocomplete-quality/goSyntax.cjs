const { spawnSync } = require('node:child_process');
// gofmt parses stdin without evaluating source, including CRLF and Unicode.
function goSyntax(source) {
  const result = spawnSync(process.env.DROID_AUTOCOMPLETE_GOFMT ?? 'gofmt', [], {
    input: source, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 1_000_000,
  });
  if (result.error) throw result.error;
  return { compiled: result.status === 0,
    diagnostics: result.status === 0 ? [] : [{ message: result.stderr || 'Go parser failed' }] };
}
module.exports = { goSyntax };
