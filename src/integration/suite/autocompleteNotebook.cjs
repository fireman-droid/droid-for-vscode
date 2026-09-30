const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

async function runNotebook() {
  const results = [], requests = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(req.url, '/v1/fim/completions'); assert.equal(body.stream, true);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ text: 'factor * 21' }] }) + '\n\ndata: [DONE]\n\n');
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
  await vscode.extensions.getExtension('droid-test.droid-notebook-fixture').activate();
  try {
    await config.update('enabled', false, true);
    await config.update('relatedFiles', false, true);
    await config.update('endpoint', 'http://127.0.0.1:' + server.address().port + '/v1/fim/completions', true);
    await config.update('protocol', 'fim', true);
    await config.update('model', 'synthetic-autocomplete', true);
    const notebook = await vscode.workspace.openNotebookDocument('droid-synthetic-completion', new vscode.NotebookData([
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'const factor = 2;', 'typescript'),
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'const answer = ', 'typescript'),
    ]));
    const document = notebook.cellAt(1).document;
    await vscode.window.showNotebookDocument(notebook, { selections: [new vscode.NotebookRange(1, 2)], preview: false });
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === document, 'Notebook code cell did not receive editor focus');
    const editor = vscode.window.activeTextEditor;
    const position = document.positionAt(document.getText().length); editor.selection = new vscode.Selection(position, position);
    await config.update('enabled', true, true);
    await config.update('autoTrigger', false, true);
    await config.update('snoozeUntil', Date.now() + 60_000, true);
    await delay(150);
    await vscode.commands.executeCommand('droidvisx.autocomplete.trigger');
    await until(() => requests.length > 0, 'Notebook cell did not request FIM');
    assert.ok(requests.at(-1).prompt.includes('const factor = 2;\n\nconst answer = '), 'FIM must receive the preceding code cell');
    await until(async () => { await vscode.commands.executeCommand('editor.action.inlineSuggest.commit'); return document.getText() !== 'const answer = '; }, 'Notebook suggestion could not be accepted');
    assert.equal(document.getText(), 'const answer = factor * 21');
    results.push({ name: 'Notebook context and native Tab acceptance while automatic requests are paused', passed: true });
    await config.update('enabled', false, true); await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), 'const answer = ');
    results.push({ name: 'Notebook completion Undo restores the cell', passed: true });
  } catch (error) { results.push({ name: 'Notebook production completion', passed: false, error: error.message }); }
  finally {
    await config.update('enabled', false, true); await config.update('autoTrigger', true, true); await config.update('snoozeUntil', 0, true);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  return results;
}
async function until(predicate, message) { const end = Date.now() + 7000; do { if (await predicate()) return; await delay(100); } while (Date.now() < end); throw Error(message); }
async function run() {
  await vscode.extensions.getExtension('droidvisx.droidvisx').activate();
  const cases = await runNotebook();
  require('node:fs').writeFileSync(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT, JSON.stringify({ editorVersion: vscode.version,
    failed: cases.filter(result => !result.passed).length, cases }, null, 2));
  assert.ok(cases.every(result => result.passed), 'Notebook native acceptance failed');
}
module.exports = { runNotebook, run };
