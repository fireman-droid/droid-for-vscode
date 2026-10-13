const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Parse only: native editor evaluation must never execute candidate code.
function pythonSyntax(code, filename) {
  const result = spawnSync(process.env.DROID_AUTOCOMPLETE_PYTHON ?? 'python',
    ['-X', 'utf8', '-I', '-S', '-B', path.join(__dirname, 'runCase.py'), '--syntax'], {
      input: JSON.stringify({ code, filename }), encoding: 'utf8', windowsHide: true,
      timeout: 5000, maxBuffer: 100_000,
    });
  if (result.error || result.status !== 0) throw new Error('Python syntax worker failed: ' + (result.error?.message ?? result.stderr));
  return JSON.parse(result.stdout);
}
module.exports = { pythonSyntax };
