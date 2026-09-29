const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

// Verify the packaged provider's actual request, using only a temporary workspace
// and a controlled definition provider. No model, account or real code is used.
async function runContext() {
  const results = [], requests = [], config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
  const root = path.join(path.dirname(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT), 'workspace');
  assert.equal(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase(), root.toLowerCase());
  const main = vscode.Uri.file(path.join(root, 'context-main.ts'));
  const types = vscode.Uri.file(path.join(root, 'context-types.ts'));
  let stalled = false, lookups = 0;
  const registration = vscode.languages.registerDefinitionProvider({language:'typescript',scheme:'file'}, {
    provideDefinition(document, position) {
      if (document.uri.toString() !== main.toString() || position.line !== 0) return [];
      lookups++;
      if (stalled) return new Promise(() => {});
      return new vscode.Location(types, new vscode.Range(0, 0, 1, 0));
    },
  });
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk;
      assert.equal(request.url, '/v1/fim/completions');
      requests.push(JSON.parse(body));
      response.writeHead(200, {'content-type':'application/json'});
      response.end(JSON.stringify({choices:[{text:''}]}));
    } catch { response.writeHead(500); response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await config.update('enabled', false, true);
    await config.update('protocol', 'fim', true);
    await config.update('endpoint', `http://127.0.0.1:${server.address().port}/v1/fim/completions`, true);
    await config.update('model', 'codestral-latest', true);
    await config.update('relatedFiles', true, true);
    await config.update('autoTrigger', false, true);
    writeFileSync(types.fsPath, 'export type User = { nativeClosedDefinition: string };\n');
    writeFileSync(main.fsPath, "import { User } from './context-types';\nconst user: User = ");
    const document = await vscode.workspace.openTextDocument(main);
    const editor = await vscode.window.showTextDocument(document, {preview:false});
    const cursor = () => { const end = document.positionAt(document.getText().length); editor.selection = new vscode.Selection(end,end); };
    cursor();
    await config.update('enabled', true, true);
    await delay(350);
    const capture = async () => {
      const before = requests.length;
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      const deadline = Date.now() + 5000;
      while (requests.length === before && Date.now() < deadline) await delay(50);
      assert.ok(requests.length > before, 'Context collection blocked the model request.');
      await delay(150);
      return requests.at(-1);
    };
    for (const name of ['Codestral EOF includes closed definition', 'Body typing reuses import lookup', 'Stalled LSP still reaches the completion endpoint']) {
      try {
        const previousLookups = lookups;
        if (name.startsWith('Body')) {
          await editor.edit(edit => edit.insert(editor.selection.active, 'u')); cursor();
        }
        if (name.startsWith('Stalled')) {
          stalled = true;
          const line = document.lineAt(0);
          await editor.edit(edit => edit.replace(line.range, "import { User } from './unavailable';")); cursor();
        }
        const payload = await capture();
        assert.equal(payload.suffix, '');
        if (!stalled) assert.ok(payload.prompt.includes('nativeClosedDefinition'), 'Closed reference was dropped at EOF.');
        if (name.startsWith('Body')) assert.equal(lookups, previousLookups, 'A body-only edit queried the same import again.');
        if (stalled) assert.ok(payload.prompt.endsWith('const user: User = u'));
        results.push({name,passed:true});
      } catch (error) { results.push({name,passed:false,error:error.message}); }
    }
  } finally {
    await config.update('enabled', false, true);
    registration.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  return results;
}
module.exports = {runContext};
