const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

// Exercises the shipped provider through real editor commands, with synthetic code only.
async function run() {
  const results = [];
  const requests = [];
  let activeCase;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      assert.equal(payload.stream, true);
      assert.equal(typeof payload.prefix, 'string');
      assert.equal(typeof payload.suffix, 'string');
      assert.ok(payload.prefix.includes('Sort the values'));
      const scenario = activeCase;
      assert.ok(scenario, 'Unexpected request outside a test case.');
      const record = { responded: false };
      requests.push(record);
      const isCancelledReplacement = scenario.behavior === 'cancel' && payload.prefix.endsWith('x');
      const completion = isCancelledReplacement ? '' : scenario.completion;
      await delay(isCancelledReplacement ? 10 : scenario.delayMs);
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: completion } }] }) + '\n\ndata: [DONE]\n\n');
      record.responded = true;
    } catch {
      if (response.destroyed) return;
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Synthetic completion request was invalid.' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    if (vscode.workspace.workspaceFolders) {
      assert.equal(vscode.workspace.workspaceFolders.length, 1);
      assert.equal(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase(),
        path.resolve(path.dirname(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT),'workspace').toLowerCase(),
        'Tests may only open their own empty temporary workspace.');
    }
    await until(() => !!vscode.extensions.getExtension('droidvisx.droidvisx'), 15000, 'Packaged Droid extension was not registered by the editor.');
    const extension = vscode.extensions.getExtension('droidvisx.droidvisx');
    await extension.activate();
    await until(() => vscode.workspace.getConfiguration('droidvisx.autocomplete').inspect('endpoint')?.defaultValue !== undefined,
      15000, 'Editor did not register the packaged autocomplete configuration.');
    const config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
    await config.update('endpoint', 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions', vscode.ConfigurationTarget.Global);
    await config.update('protocol', 'siliconflow-fim', vscode.ConfigurationTarget.Global);
    await config.update('model', 'synthetic-autocomplete', vscode.ConfigurationTarget.Global);
    assert.ok(extension, 'Packaged Droid extension must be discoverable.');
    assert.equal(extension.isActive, true);
    assert.ok((await vscode.commands.getCommands(true)).includes('droidvisx.autocomplete.trigger'));
    const scenarios = [];
    const supportsDisableAI = vscode.workspace.getConfiguration('chat').inspect('disableAIFeatures')?.defaultValue !== undefined;
    for (const disableAI of supportsDisableAI ? [false, true] : [false]) {
      for (const trailingNewline of [false, true]) {
        scenarios.push({ name: 'Python blank line, terminal LF=' + trailingNewline + ', AI disabled=' + disableAI,
          language: 'python', location: 'blank', completion: 'values.sort()' + (trailingNewline ? '\n' : ''),
          expectedInsertion: 'values.sort()', disableAI, delayMs: 2200 });
      }
    }
    for (const eol of ['\n', '\r\n']) {
      for (const location of ['eof', 'existing']) {
        scenarios.push({ name: 'Python ' + location + ', ' + (eol === '\n' ? 'LF' : 'CRLF'),
          language: 'python', location, eol, completion: 'values.sort()\n', expectedInsertion: location === 'existing' ? 'values.sort()\n' : 'values.sort()' });
      }
    }
    scenarios.push({ name: 'Python blank line, CRLF', language: 'python', location: 'blank', eol: '\r\n', completion: 'values.sort()\n', expectedInsertion: 'values.sort()' });
    for (const [language, completion, expectedInsertion] of [['go', 'sort.Ints(values)\n', 'sort.Ints(values)'], ['java', 'Arrays.sort(values);\n', 'Arrays.sort(values);'], ['typescript', 'values.sort((a, b) => a - b);\n', 'values.sort((a, b) => a - b);']]) {
      scenarios.push({ name: language + ' automatic completion', language, location: 'blank', completion, expectedInsertion });
    }
    scenarios.push({ name: 'Saved Python file with related context enabled', language: 'python', location: 'blank', saved: true, relatedFiles: true, eol: '\r\n', completion: 'values.sort()\n', expectedInsertion: 'values.sort()' });
    scenarios.push({ name: 'Typing a matching character reuses the visible completion', language: 'python', location: 'blank', completion: 'values.sort()\n', expectedInsertion: 'values.sort()', behavior: 'continue' });
    scenarios.push({ name: 'Always Show Toolbar keeps the active suggestion acceptable', language: 'python', location: 'blank', completion: 'values.sort()', expectedInsertion: 'values.sort()', behavior: 'toolbar' });
    scenarios.push({ name: 'Hide dismisses suggestion without inserting', language: 'python', location: 'blank', completion: 'values.sort()', behavior: 'hide' });
    scenarios.push({ name: 'Typing cancels a delayed stale suggestion', language: 'python', location: 'blank', completion: 'values.sort()', behavior: 'cancel', delayMs: 800 });
    for (const scenario of scenarios) {
      activeCase = { eol: '\n', disableAI: false, delayMs: 100, ...scenario };
      try {
        if (supportsDisableAI) await vscode.workspace.getConfiguration('chat').update('disableAIFeatures', activeCase.disableAI, vscode.ConfigurationTarget.Global);
        await config.update('relatedFiles', activeCase.relatedFiles === true, vscode.ConfigurationTarget.Global);
        const comment = (activeCase.language === 'python' ? '#' : '//') + ' Sort the values';
        const followingCode = activeCase.language === 'python' ? 'print(values)' : 'consume(values);';
        const suffix = activeCase.location === 'eof' ? '' : activeCase.location === 'existing'
          ? '\n' + followingCode + '\n' : '\n\n' + followingCode + '\n';
        let document;
        if (activeCase.saved) {
          const filePath = path.join(path.dirname(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT), 'synthetic-autocomplete.py');
          writeFileSync(filePath, comment + suffix);
          document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        } else {
          document = await vscode.workspace.openTextDocument({ language: activeCase.language, content: comment + suffix });
        }
        const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
        await editor.edit((edit) => edit.setEndOfLine(activeCase.eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF));
        const explicit = activeCase.location === 'existing';
        const position = explicit ? new vscode.Position(1, 0) : new vscode.Position(0, comment.length);
        editor.selection = new vscode.Selection(position, position);
        await delay(100);
        const beforeRequests = requests.length;
        if (explicit) await vscode.commands.executeCommand('droidvisx.autocomplete.trigger');
        else await vscode.commands.executeCommand('type', { text: '\n' });
        const before = document.getText();
        const offset = document.offsetAt(editor.selection.active);
        await until(() => requests.length > beforeRequests, 5000, 'The editor did not request a completion.');
        if (activeCase.behavior === 'cancel') {
          await vscode.commands.executeCommand('type', { text: 'x' });
          const typed = document.getText();
          await delay(activeCase.delayMs + 500);
          await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
          assert.equal(document.getText(), typed, 'A stale suggestion must not survive subsequent typing.');
        } else if (activeCase.behavior === 'hide') {
          await until(() => requests[beforeRequests].responded, 5000, 'Synthetic response did not finish.');
          await delay(300);
          await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
          await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
          assert.equal(document.getText(), before, 'Dismissing must leave the document unchanged.');
        } else {
          // At an empty line the existing line break separates following code; terminal blank lines are not inserted.
          const insertion = activeCase.expectedInsertion;
          const expected = before.slice(0, offset) + insertion.replace(/\n/g, activeCase.eol) + before.slice(offset);
          let unchanged = before;
          if (activeCase.behavior === 'continue') {
            await until(() => requests[beforeRequests].responded, 5000, 'Synthetic response did not finish.');
            await delay(300);
            await vscode.commands.executeCommand('type', { text: 'v' });
            unchanged = document.getText();
            await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          }
          if (activeCase.behavior === 'toolbar') {
            await until(() => requests[beforeRequests].responded, 5000, 'Synthetic response did not finish.');
            await delay(300);
            await vscode.commands.executeCommand('editor.action.inlineSuggest.toggleAlwaysShowToolbar');
            await until(() => vscode.workspace.getConfiguration('editor').get('inlineSuggest.showToolbar') === 'always', 5000, 'Toolbar preference was not saved.');
            await delay(300);
          }
          // This is the exact editor command used by Tab, not a provider call or document edit.
          await until(async () => {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
            return document.getText() !== unchanged;
          }, 7000, 'Model response was not accepted by the native inline-suggestion action.');
          assert.equal(document.getText(), expected, 'Acceptance must preserve surrounding code and line endings.');
          if (activeCase.behavior === 'continue') assert.equal(requests.length, beforeRequests + 1, 'Matching continuation should reuse the provider cache.');
        }
        results.push({ name: activeCase.name, passed: true });
      } catch (error) {
        results.push({ name: activeCase.name, passed: false, error: error.message });
      } finally {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        activeCase = undefined;
      }
    }
    results.push(...await require('./nextEdit.cjs').runNextEdit());
  } catch (error) {
    results.push({ name: 'packaged extension setup', passed: false, error: error.message });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    writeFileSync(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT, JSON.stringify({ editorVersion: vscode.version,
      requests: requests.length, failed: results.filter((result) => !result.passed).length, cases: results }, null, 2));
  }
  assert.ok(results.every((result) => result.passed), 'Native autocomplete acceptance failed.');
}
async function until(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(message);
}
module.exports = { run };
