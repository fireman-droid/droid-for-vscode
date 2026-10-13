const assert = require('node:assert/strict');

// Check the actual production prompt before forwarding it to the model. These
// headers cover the TS/Go/Python fixtures and the Codestral multi-file template.
function assertFixtureContext(prompt, allowedFiles) {
  const source = prompt.replace(/^<\|fim_prefix\|>/, '');
  const files = [...source.matchAll(/^(?:(?:\/\/|#) Reference file: (.+)|\+{5} (.+)|--- Reference file: (.+) ---)\r?$/gm)]
    .map(match => (match[1] ?? match[2] ?? match[3]).trim());
  for (const file of files) assert.ok(allowedFiles.includes(file), `Unrelated fixture entered model context: ${file}`);
  return files;
}

module.exports = { assertFixtureContext };
