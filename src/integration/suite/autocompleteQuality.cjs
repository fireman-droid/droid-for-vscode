const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');
const ts = require('../../../node_modules/typescript');
const { createHostClient } = require('../autocomplete-quality/hostClient.cjs');
const { pythonSyntax } = require('../autocomplete-quality/pythonSyntax.cjs');
const { goSyntax } = require('../autocomplete-quality/goSyntax.cjs');

// Actual editor commands and the packaged Provider, with raw model output relayed by
// the credential-owning Host. Hidden tests/solutions are never passed to the model.
async function run() {
  const requestModel = createHostClient();
  const settings = await requestModel({ kind: 'settings' });
  assert.equal(settings.protocol, 'fim', 'Native relay currently supports the FIM protocol.');
  const corpusText = readFileSync(process.env.DROID_AUTOCOMPLETE_QUALITY_CORPUS, 'utf8');
  const corpus = JSON.parse(corpusText);
  const resultFile = process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT;
  const root = path.join(path.dirname(resultFile), 'workspace');
  assert.equal(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase(), root.toLowerCase());
  const report = { corpusSha256: createHash('sha256').update(corpusText).digest('hex'), ...settings,
    packageSha256: process.env.DROID_AUTOCOMPLETE_PACKAGE_SHA256,
    contextMode: 'native-context', acceptanceMode: 'automatic-then-explicit', records: [] };
  let current;
  const server = createServer(async (request, response) => {
    const record = current;
    try {
      assert.equal(request.url, '/v1/fim/completions');
      assert.ok(record, 'No active case');
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      if (record.probeCacheOnly) {
        record.cacheProbeMiss = true;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ text: '' }] }));
        return; // Drain an existing multiline suggestion without buying another generation.
      }
      const attempt = { prompt: payload.prompt, suffix: payload.suffix, startedAt: Date.now() };
      record.requests.push(attempt);
      // The live Host adds its Mercury prefix marker; strip exactly that marker
      // to preserve the already constructed native prompt, without duplication.
      const prefix = settings.model.toLowerCase().includes('mercury') && payload.suffix
        && payload.prompt.startsWith('<|fim_prefix|>') ? payload.prompt.slice('<|fim_prefix|>'.length) : payload.prompt;
      const result = await requestModel(settings.rawTransport ? { kind: 'raw-fim', body: payload }
        : { prefix, suffix: payload.suffix ?? '', language: record.language, filepath: record.entryFile, references: [] });
      if (result.error) throw new Error(`Model failed: ${result.code ?? result.error}`);
      attempt.raw = result.raw; attempt.elapsedMs = Date.now() - attempt.startedAt;
      if (response.destroyed) { attempt.cancelled = true; return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ text: result.raw }] }));
      attempt.responded = true;
    } catch (error) {
      if (record) record.transportError = String(error.message);
      if (!response.destroyed) { response.writeHead(502); response.end('{}'); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
  try {
    await vscode.extensions.getExtension('droidvisx.droidvisx').activate();
    // Fixtures already include their closing delimiters. Native typing must not
    // add a second one and silently change the problem sent to the model.
    const editorConfig = vscode.workspace.getConfiguration('editor');
    await editorConfig.update('autoClosingBrackets', 'never', true);
    await editorConfig.update('autoClosingQuotes', 'never', true);
    await editorConfig.update('autoIndent', 'none', true);
    await config.update('enabled', false, true);
    for (const [key, value] of Object.entries({ protocol: 'fim', endpoint: `http://127.0.0.1:${server.address().port}/v1/fim/completions`,
      model: settings.model, maxTokens: settings.maxTokens, maxContextCharacters: settings.maxContextCharacters,
      relatedFiles: true, autoTrigger: true })) await config.update(key, value, true);
    for (const item of corpus.cases) {
      const record = { id: item.id, category: item.category, language: item.language, entryFile: item.entryFile,
        contextMode: item.language === 'typescript' ? 'typescript-lsp' : `open-files-without-${item.language}-lsp`,
        requests: [], accepts: [], diagnostics: [] };
      current = record; report.records.push(record);
      try {
        await config.update('enabled', false, true);
        const directory = path.join(root, item.id); mkdirSync(directory, { recursive: true });
        const lastInputLength = item.prefix.endsWith('\r\n') ? 2 : 1;
        for (const file of [{ path: item.entryFile, content: item.prefix.slice(0, -lastInputLength) + item.suffix }, ...item.references]) {
          const target = path.resolve(directory, file.path);
          assert.ok(target.startsWith(directory + path.sep), 'Fixture path escaped its directory');
          mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, file.content);
        }
        if (item.language === 'typescript') writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
          target: 'ES2022', module: 'commonjs', strict: true, types: [], lib: ['ES2022', 'DOM'] },
          files: [item.entryFile, ...item.references.map(file => file.path)] }));
        // No Python or Go language extension is installed in this isolated profile.
        // Exercise the production opened-file context path and label it honestly.
        if (item.language !== 'typescript') for (const reference of item.references) {
          await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, reference.path)));
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, item.entryFile)));
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const cursor = document.positionAt(item.prefix.length - lastInputLength);
        editor.selection = new vscode.Selection(cursor, cursor);
        // Start the real built-in TypeScript language service before timing edits.
        const language = item.language === 'typescript' && vscode.extensions.getExtension('vscode.typescript-language-features');
        if (language) await language.activate();
        await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
        await config.update('enabled', true, true); await delay(200);
        const beforeType = record.requests.length;
        await vscode.commands.executeCommand('type', { text: item.prefix.slice(-1) });
        assert.equal(document.getText(), item.prefix + item.suffix, 'Native typing changed the supplied fixture');
        const started = Date.now();
        await until(() => record.requests.length > beforeType || record.transportError, 3500);
        record.automaticRequested = record.requests.length > beforeType;
        for (let step = 0; step < 12; step++) {
          const before = document.getText();
          if (step > 0 || !record.automaticRequested) await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          let changed = false;
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline && !record.transportError && !record.cacheProbeMiss) {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
            if (document.getText() !== before) { changed = true; break; }
            await delay(80);
          }
          if (!changed) {
            record.stop = record.transportError ? 'transport-error' : record.probeCacheOnly ? 'source-complete' : 'no-acceptable-suggestion';
            break;
          }
          record.accepts.push({ step, elapsedMs: Date.now() - started, addedCharacters: document.getText().length - before.length });
          const text = document.getText();
          assert.ok(text.startsWith(item.prefix) && text.endsWith(item.suffix), 'Completion changed existing surrounding code');
          record.insertion = text.slice(item.prefix.length, item.suffix ? -item.suffix.length : undefined);
          record.diagnostics = diagnose(document, item, directory);
          // A first-line preview can compile while its cached next lines remain.
          // Drain those lines before stopping; hidden tests never guide acceptance.
          record.probeCacheOnly = item.language !== 'typescript' ? record.diagnostics.length === 0
            : !record.diagnostics.some(issue => [1005, 1109, 1128, 2355, 2366].includes(issue.code));
          if (step === 11) record.stop = 'acceptance-limit';
        }
        record.elapsedMs = Date.now() - started;
      } catch (error) { record.error = String(error.stack ?? error).slice(0, 3000); }
      finally {
        await config.update('enabled', false, true);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        writeFileSync(process.env.DROID_AUTOCOMPLETE_QUALITY_OUTPUT, JSON.stringify(report, null, 2));
      }
      if (record.transportError) break;
    }
  } finally { await config.update('enabled', false, true); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const infrastructureFailures = report.records.filter(record => record.error || record.transportError).length;
  writeFileSync(resultFile, JSON.stringify({ failed: infrastructureFailures, cases: report.records.length,
    offered: report.records.filter(record => record.insertion).length, report: process.env.DROID_AUTOCOMPLETE_QUALITY_OUTPUT }));
}

function diagnose(document, item, directory) {
  if (item.language === 'python') return pythonSyntax(document.getText(), item.entryFile).diagnostics;
  if (item.language === 'go') return goSyntax(document.getText()).diagnostics;
  const host = ts.createCompilerHost({});
  const read = host.readFile;
  host.readFile = file => path.resolve(file).toLowerCase() === path.resolve(document.uri.fsPath).toLowerCase() ? document.getText() : read(file);
  const program = ts.createProgram([document.uri.fsPath, ...item.references.map(file => path.join(directory, file.path))], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, skipLibCheck: true,
    noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  }, host);
  return ts.getPreEmitDiagnostics(program).map(issue => ({ code: issue.code, message: ts.flattenDiagnosticMessageText(issue.messageText, '\n') }));
}
async function until(predicate, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!predicate() && Date.now() < deadline) await delay(50);
}
module.exports = { run };
