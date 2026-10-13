const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');
const { createHostClient } = require('../autocomplete-quality/hostClient.cjs');

// Real packaged Next Edit, editor history and Tab/jump acceptance. Only authored
// initial files and user edits enter the workspace; oracles/tests stay outside it.
async function run() {
  const requestModel = createHostClient(), settings = await requestModel({ kind: 'settings' });
  assert.ok(settings.nextEditAvailable, 'The configured official Mercury service is required');
  const corpusText = readFileSync(process.env.DROID_AUTOCOMPLETE_QUALITY_CORPUS, 'utf8');
  const corpus = JSON.parse(corpusText);
  assert.equal(corpus.mode, 'next-edit');
  const resultFile = process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT;
  const root = path.join(path.dirname(resultFile), 'workspace');
  assert.equal(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase(), root.toLowerCase());
  const report = { corpusSha256: createHash('sha256').update(corpusText).digest('hex'), model: settings.model,
    protocol: 'mercury-edit', maxTokens: Math.max(512, settings.maxTokens), contextMode: 'native-edit-history-case-isolated',
    packageSha256: process.env.DROID_AUTOCOMPLETE_PACKAGE_SHA256, requestLimit: 3, records: [] };
  let current;
  const server = createServer(async (request, response) => {
    const record = current;
    try {
      assert.equal(request.url, '/v1/edit/completions'); assert.ok(record);
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      for (const match of payload.messages[0].content.matchAll(/(?:code_snippet_file_path|current_file_path): ([^\r\n]+)/g)) {
        assert.ok(match[1].startsWith(record.id + '/'), 'Another fixture entered the native model context');
      }
      if (record.requests.length >= report.requestLimit) {
        record.limitReached = true;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] }));
        return; // A labelled local limit, never scored as a model failure/response.
      }
      const attempt = { prompt: payload.messages[0].content, startedAt: Date.now() };
      record.requests.push(attempt);
      Object.assign(attempt, await requestModel({ kind: 'raw-next-edit', body: payload }));
      if (response.destroyed) { attempt.cancelled = true; return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ finish_reason: attempt.finishReason, message: { content: attempt.raw } }] }));
      attempt.responded = true;
    } catch (error) {
      if (record) record.transportError = error.message;
      if (!response.destroyed) { response.writeHead(502); response.end('{}'); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
  try {
    await vscode.extensions.getExtension('droidvisx.droidvisx').activate();
    await config.update('enabled', false, true);
    for (const [key, value] of Object.entries({ protocol: 'mercury-edit',
      endpoint: `http://127.0.0.1:${server.address().port}/v1/edit/completions`, model: settings.model,
      maxTokens: settings.maxTokens, maxContextCharacters: settings.maxContextCharacters, relatedFiles: true, autoTrigger: false,
    })) await config.update(key, value, true);
    const editorConfig = vscode.workspace.getConfiguration('editor');
    for (const key of ['autoClosingBrackets', 'autoClosingQuotes']) await editorConfig.update(key, 'never', true);
    await editorConfig.update('autoIndent', 'none', true);
    for (const item of corpus.cases) {
      const record = { id: item.id, language: item.language, entryFile: item.entryFile, requests: [], accepts: [], edits: [] };
      const documents = new Map();
      current = record; report.records.push(record);
      try {
        assert.equal(item.language, 'typescript');
        assert.ok(corpus.cases.every(item => /^[a-z0-9-]+$/.test(item.id)));
        assert.ok(item.edits.length > 0 && item.edits.at(-1).path === item.entryFile);
        await config.update('enabled', false, true);
        await config.update('autoTrigger', false, true);
        // Closed files remain legitimate recent context in production. Independent
        // benchmark questions must not see each other's code through that history.
        await config.update('excludePatterns', corpus.cases.filter(other => other.id !== item.id)
          .map(other => `**/${other.id}/**`), true);
        const directory = path.join(root, item.id);
        for (const file of item.initialFiles) {
          const target = path.resolve(directory, file.path);
          assert.ok(target.startsWith(directory + path.sep), 'Fixture path escaped its directory');
          mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, file.content);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
          documents.set(file.path, document);
          await vscode.window.showTextDocument(document, { preview: false });
        }
        writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
          target: 'ES2022', module: 'commonjs', strict: true, types: [], lib: ['ES2022', 'DOM'] },
          files: item.initialFiles.map(file => file.path) }));
        await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
        await config.update('enabled', true, true); await delay(250);
        let editor, document, started;
        for (let index = 0; index < item.edits.length; index++) {
          const edit = item.edits[index]; document = documents.get(edit.path); assert.ok(document);
          editor = await vscode.window.showTextDocument(document, { preview: false });
          await delay(150);
          const text = document.getText(), offset = text.indexOf(edit.before);
          assert.ok(edit.before && offset >= 0 && text.indexOf(edit.before, offset + 1) === -1, 'User edit must match exactly once');
          const range = new vscode.Range(document.positionAt(offset), document.positionAt(offset + edit.before.length));
          editor.selection = new vscode.Selection(range.start, range.end);
          if (index === item.edits.length - 1) await config.update('autoTrigger', true, true);
          started = Date.now();
          await vscode.commands.executeCommand('type', { text: edit.after });
          assert.equal(document.getText(), text.slice(0, offset) + edit.after + text.slice(offset + edit.before.length));
          record.edits.push({ path: edit.path, before: text, after: document.getText(), cursor: editor.selection.active });
        }
        record.beforeSource = document.getText();
        record.references = [...documents].filter(([name]) => name !== item.entryFile)
          .map(([name, doc]) => ({ path: name, content: doc.getText() }));
        await until(() => record.requests.length > 0 || record.transportError, 3500);
        record.automaticRequested = record.requests.length > 0;
        let pending = record.automaticRequested;
        for (let step = 0; step < report.requestLimit && !record.transportError; step++) {
          const before = document.getText(), previousRequests = record.requests.length;
          if (!pending) await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          pending = false;
          const deadline = Date.now() + 8000;
          let jumps = 0;
          while (Date.now() < deadline && document.getText() === before && !record.transportError && !record.limitReached) {
            const position = editor.selection.active;
            await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
            if (document.getText() === before) await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.acceptOrJump');
            if (!position.isEqual(editor.selection.active) && document.getText() === before) jumps++;
            if (document.getText() === before) await delay(80);
          }
          if (document.getText() === before) { record.stop = record.limitReached ? 'request-limit' : 'no-acceptable-edit'; break; }
          record.accepts.push({ step, source: document.getText(), jumps, elapsedMs: Date.now() - started });
          // Allow production's acceptance chain to start before an explicit fallback.
          await until(() => record.requests.length > previousRequests || record.transportError, 500);
          pending = record.requests.length > previousRequests;
        }
        record.source = document.getText();
        record.elapsedMs = Date.now() - started;
        record.stop ??= 'acceptance-limit';
      } catch (error) { record.error = String(error.stack ?? error).slice(0, 3000); }
      finally {
        await config.update('enabled', false, true);
        await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.dismiss');
        writeFileSync(process.env.DROID_AUTOCOMPLETE_QUALITY_OUTPUT, JSON.stringify(report, null, 2));
        for (const document of documents.values()) {
          if (document.isClosed) continue;
          await vscode.window.showTextDocument(document, { preview: false });
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        }
      }
      if (record.transportError || record.error) break;
    }
  } finally { await config.update('enabled', false, true); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(resultFile, JSON.stringify({ failed: report.records.filter(record => record.error || record.transportError).length,
    cases: report.records.length, offered: report.records.filter(record => record.accepts.length).length,
    report: process.env.DROID_AUTOCOMPLETE_QUALITY_OUTPUT }));
}
async function until(predicate, milliseconds) {
  const end = Date.now() + milliseconds;
  while (!predicate() && Date.now() < end) await delay(50);
}
module.exports = { run };
