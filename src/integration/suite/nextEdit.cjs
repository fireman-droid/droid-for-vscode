const assert = require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

async function runNextEdit() {
  const results = [], config = vscode.workspace.getConfiguration('droidvisx.autocomplete');
  let scenario, lastPrompt, calls = 0, replied = 0, fimCalls = 0;
  const server = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const payload = JSON.parse(raw);
      if (request.url === '/v1/fim/completions') {
        assert.ok(scenario?.independent); assert.equal(payload.stream, true); fimCalls++;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end('data: '+JSON.stringify({choices:[{delta:{content:''}}]})+'\n\ndata: [DONE]\n\n');
        return;
      }
      assert.equal(request.url, '/v1/edit/completions');
      assert.equal(payload.stream, false);
      assert.equal(payload.max_tokens, 512, 'Use the production default output budget.');
      assert.ok(payload.messages[0].content.includes('<|!@#IS_NEXT_EDIT!@#|>'));
      lastPrompt = payload.messages[0].content;
      const current = scenario; assert.ok(current); calls++;
      await delay(current.delay ?? 50);
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': 'application/json' });
      const fence=String.fromCharCode(96).repeat(3);
      response.end(JSON.stringify({ choices: [{ finish_reason: current.truncated ? 'length' : 'stop',
        message: { content: fence+'\n'+current.replacement+'\n'+fence } }] }));
      replied++;
    } catch { if (!response.destroyed) { response.writeHead(500); response.end('{}'); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await config.update('enabled', false, true);
    await config.update('protocol', 'mercury-edit', true);
    await config.update('endpoint', 'http://127.0.0.1:'+server.address().port+'/v1/edit/completions', true);
    await config.update('model', 'synthetic-mercury-edit', true);
    await config.update('relatedFiles', false, true);
    const boundarySource = ['export function label(value: string) {', "  const suffix = '}';", '  return value + suffix;', '}', '',
      'export function format(value: string) {', '  return value;', '}', '',
      'export function literal(value: string) {', '  return value;', '}'].join('\n');
    const cases = [
      {name:'Independent FIM falls through to Next Edit deletion and Undo', source:'// cleanup\nconst unused = 1;\nconsole.log(2);', replacement:'// cleanup\nconsole.log(2);', cursor:[1,0], independent:true},
      {name:'Independent FIM falls through to multiline replacement', source:'// simplify\nconst a = 1;\nconst b = 2;', replacement:'// simplify\nconst total = 3;', cursor:[1,0], independent:true},
      {name:'Native same-line insertion and Undo', source:'const value = ', replacement:'const value = 42;', cursor:[0,14], inline:true},
      {name:'Automatic Next Edit after idle preserves typed input through Undo', source:'const value = ',
        replacement:'const value = 2;', cursor:[0,14], automaticText:'1;'},
      {name:'Off-cursor rename jumps before applying', source:'const name = 1;\nconsole.log(old);', replacement:'const name = 1;\nconsole.log(name);', cursor:[0,14], jump:1, saved:true},
      {name:'Syntax-aligned region does not duplicate the adjacent closing brace', source:boundarySource,
        replacement:boundarySource.replace('return value + suffix;', 'return value.toUpperCase() + suffix;'), cursor:[0,0], jump:2, saved:true},
      {name:'Multiline replacement and Undo', source:'// simplify\nconst a = 1;\nconst b = 2;\nconsole.log(a+b);', replacement:'// simplify\nconsole.log(3);', cursor:[1,0]},
      {name:'Deletion of a middle line', source:'// cleanup\nconst unused = 1;\nconsole.log(2);', replacement:'// cleanup\nconsole.log(2);', cursor:[1,0]},
      {name:'Deletion at end of file', source:'// cleanup\nconsole.log(2);\nconst unused = 1;', replacement:'// cleanup\nconsole.log(2);', cursor:[2,0]},
      {name:'Insertion at EOF preserves CRLF', source:'// extend\r\nconst a = 1;', replacement:'// extend\nconst a = 1;\nconsole.log(a);', cursor:[1,0], eol:'\r\n'},
      {name:'CRLF multiline replacement', source:'// simplify\r\nconst a = 1;\r\nconst b = 2;', replacement:'// simplify\nconst total = 3;', cursor:[1,0], eol:'\r\n'},
      {name:'Whole-region deletion', source:'const unused = 1;', replacement:'', cursor:[0,0]},
      {name:'Esc dismissal leaves text intact', source:'const name = 1;\nconsole.log(old);', replacement:'const name = 1;\nconsole.log(name);', cursor:[1,0], behavior:'dismiss'},
      {name:'Changing another line invalidates pending edit', source:'// keep\nconsole.log(old);', replacement:'// keep\nconsole.log(name);', cursor:[1,0], behavior:'drift'},
      {name:'Disabling feature invalidates pending edit', source:'// keep\nconsole.log(old);', replacement:'// keep\nconsole.log(name);', cursor:[1,0], behavior:'disable'},
      {name:'Truncated response cannot be accepted', source:'// keep\nconsole.log(old);', replacement:'// keep\nconsole.log(name);', cursor:[1,0], truncated:true},
      {name:'Typing discards a delayed prediction', source:'// keep\nconsole.log(old);', replacement:'// keep\nconsole.log(name);', cursor:[1,0], delay:700, behavior:'cancel'},
    ];
    for (const c of cases) {
      scenario = c;
      try {
        await config.update('enabled', false, true);
        await config.update('protocol', c.independent ? 'fim' : 'mercury-edit', true);
        await config.update('endpoint', 'http://127.0.0.1:'+server.address().port+(c.independent ? '/v1/fim/completions' : '/v1/edit/completions'), true);
        await config.update('nextEdit.endpoint', c.independent ? 'http://127.0.0.1:'+server.address().port+'/v1/edit/completions' : undefined, true);
        await config.update('nextEdit.enabled', c.independent ? true : undefined, true);
        const beforeFimCalls = fimCalls;
        let doc;
        if(c.saved){
          const filename=path.join(path.dirname(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT),`next-edit-synthetic-${cases.indexOf(c)}.ts`);
          writeFileSync(filename,c.source);
          doc=await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
        } else doc = await vscode.workspace.openTextDocument({language:'typescript',content:c.source});
        const editor = await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false});
        await editor.edit(edit=>edit.setEndOfLine(c.eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF));
        const pos = new vscode.Position(...c.cursor);
        editor.selection = new vscode.Selection(pos,pos);
        await delay(100);
        await config.update('enabled', true, true);
        await delay(150);
        if(c.automaticText) await delay(1100);
        const beforeCalls=calls, beforeReplies=replied;
        let before=doc.getText();
        assert.equal(before,c.source,'The editor must load this case before requesting an edit');
        if(c.automaticText) {
          await vscode.commands.executeCommand('type',{text:c.automaticText});
          before=doc.getText();
        } else await vscode.commands.executeCommand('droidvisx.autocomplete.trigger');
        await until(()=>calls>beforeCalls,5000,'No Next Edit request from packaged provider');
        if(c.independent) assert.equal(fimCalls, beforeFimCalls + 1, 'Exactly one FIM attempt precedes the independent edit');
        if(c.automaticText) assert.ok(lastPrompt.includes('const value = 1;'), 'Automatic prediction must include the latest typing');
        if(c.behavior==='cancel'){
          await vscode.commands.executeCommand('type',{text:'x'});
          const typed=doc.getText(); await delay(950);
          await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.acceptOrJump');
          assert.equal(doc.getText(),typed);
        } else {
          await until(()=>replied>beforeReplies,5000,'No Next Edit fixture response'); await delay(350);
          if(c.behavior==='dismiss') await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.dismiss');
          if(c.behavior==='drift') await editor.edit(e=>e.insert(new vscode.Position(0,0),'// user edit\n'));
          if(c.behavior==='disable') await config.update('enabled',false,true);
          const unchanged=doc.getText();
          if(c.jump!==undefined) {
            await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.acceptOrJump');
            assert.equal(doc.getText(),before,'First Tab must only jump');
            assert.equal(editor.selection.active.line,c.jump);
          }
          await vscode.commands.executeCommand(c.inline?'editor.action.inlineSuggest.commit':'droidvisx.autocomplete.nextEdit.acceptOrJump');
          if(c.behavior || c.truncated) assert.equal(doc.getText(),unchanged,'Invalid or dismissed edit must not apply');
          else {
            assert.equal(doc.getText(),c.replacement.replace(/\n/g,c.eol??'\n'),'Accepted edit must preserve full document');
            await config.update('enabled',false,true);
            await vscode.commands.executeCommand('undo');
            assert.equal(doc.getText(),before,'Undo must restore the complete original document');
          }
        }
        results.push({name:c.name,passed:true});
      } catch(error) { results.push({name:c.name,passed:false,error:error.message}); }
      finally {
        await config.update('enabled',false,true);
        await vscode.commands.executeCommand('droidvisx.autocomplete.nextEdit.dismiss');
        await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
    }
    // Exercise packaged Host tracking before any FIM request, not a synthetic history input.
    await config.update('autoTrigger', false, true);
    for (const resetHistory of [false, true]) {
      const name = resetHistory ? 'Disabling clears history before tracking resumes'
        : 'FIM edits survive repeated Next Edit mode switches';
      try {
        await config.update('enabled', false, true);
        await config.update('protocol', 'fim', true);
        const doc = await vscode.workspace.openTextDocument({language:'typescript',content:'const original = 1;'});
        const editor = await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false});
        await config.update('enabled', true, true);
        await delay(250);
        const replace = async text => {
          await editor.edit(edit => edit.replace(new vscode.Range(0,0,0,doc.lineAt(0).text.length),text));
          const pos = new vscode.Position(0,doc.lineAt(0).text.length);
          editor.selection = new vscode.Selection(pos,pos);
        };
        const capture = async () => {
          await config.update('protocol', 'mercury-edit', true);
          scenario = {replacement:doc.getText()};
          const previousCalls = calls, previousReplies = replied;
          await vscode.commands.executeCommand('droidvisx.autocomplete.trigger');
          await until(()=>calls>previousCalls,5000,'No request containing tracked editor context');
          const prompt = lastPrompt;
          await until(()=>replied>previousReplies,5000,'No context fixture response');
          await delay(150);
          return prompt.slice(prompt.indexOf('<|edit_diff_history|>'),prompt.indexOf('<|/edit_diff_history|>'));
        };
        await replace('const renamed = 1;');
        const first = await capture();
        assert.ok(first.includes('-const original = 1;') && first.includes('+const renamed = 1;'),
          'The first Next Edit request must retain edits made in FIM mode before any FIM request');
        await config.update('protocol', 'fim', true);
        if (resetHistory) {
          await config.update('enabled', false, true);
          await replace('const whileDisabled = 1;');
          await config.update('enabled', true, true);
          await delay(250);
        }
        await replace('const latest = 1;');
        const second = await capture();
        assert.ok(second.includes('+const latest = 1;'));
        if (resetHistory) {
          assert.ok(second.includes('-const whileDisabled = 1;'));
          assert.ok(!second.includes('const original') && !second.includes('const renamed'),
            'Re-enabling must not restore history from before disabling');
        } else {
          assert.ok(second.includes('-const renamed = 1;'));
          assert.ok(second.indexOf('-const original = 1;') >= 0 &&
            second.indexOf('-const original = 1;') < second.indexOf('-const renamed = 1;'),
          'Switching back to FIM must preserve chronological edit history');
        }
        results.push({name,passed:true});
      } catch(error) {results.push({name,passed:false,error:error.message});}
      finally {
        await config.update('enabled',false,true);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
    }
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  return results;
}
async function until(predicate, timeout, message) {
  const end=Date.now()+timeout;
  do {if(await predicate())return;await delay(50);} while(Date.now()<end);
  throw new Error(message);
}
async function run() {
  await vscode.extensions.getExtension('droidvisx.droidvisx').activate();
  const results = await runNextEdit();
  writeFileSync(process.env.DROID_AUTOCOMPLETE_NATIVE_RESULT, JSON.stringify({ editorVersion: vscode.version,
    failed: results.filter(result => !result.passed).length, cases: results }, null, 2));
  assert.ok(results.every(result => result.passed), 'Native Next Edit acceptance failed');
}
module.exports={runNextEdit, run};
