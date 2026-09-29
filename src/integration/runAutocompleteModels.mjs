import { build } from 'esbuild';
import {createPatch} from 'diff';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2];
if(!['fim','mercury-fim','next-edit'].includes(mode))throw new Error('Pass fim or next-edit');
const key=process.env[mode==='fim'?'DROID_AUTOCOMPLETE_TEST_KEY':'DROID_NEXT_EDIT_TEST_KEY'];
if(!key)throw new Error('Model test credential is required in the environment');
const withContext=process.argv.includes('--with-context');
const productionContext=process.argv.includes('--production-context');
const output=path.join(root,'artifacts/autocomplete-models',mode+(withContext?'-context':productionContext?'-complete':''));
mkdirSync(output,{recursive:true});
await build({stdin:{contents:'export {requestNextEdit} from "./src/runtime/autocomplete/nextEdit.ts"; export {requestCompletion} from "./src/runtime/autocomplete/requestCompletion.ts"; export {prepareCompletion} from "./src/extension/autocomplete/completionText.ts"; export {getTemplateForModel} from "./src/extension/autocomplete/kilo/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts"; export {buildCompletionPrompt} from "./src/extension/autocomplete/context/CompletionPrompt.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(output,'production.cjs'),logLevel:'silent'});
const api=await import('file:///'+path.join(output,'production.cjs').replaceAll('\\','/'));
const samples=JSON.parse(readFileSync(path.join(root,'src/integration/fixtures',mode!=='next-edit'?'autocompleteSamples.json':'nextEditSamples.json'),'utf8'));
const records=[];
const model=mode==='fim'?'Qwen/Qwen3-Coder-30B-A3B-Instruct':'mercury-edit-2';
let status, outputTokenLimit;
const original=globalThis.fetch;
globalThis.fetch=async(...args)=>{outputTokenLimit=JSON.parse(args[1].body).max_tokens;const response=await original(...args);status=response.status;return response;};
// One first attempt per scenario; there are no automatic retries.
for(const sample of samples.filter(sample=>!withContext||sample.id.endsWith('cross-file'))){
  const started=Date.now();status=undefined;outputTokenLimit=undefined;
  const record={id:sample.id,language:sample.language};
  try {
    if(mode!=='next-edit'){
      const snippets=sample.references.map(ref=>({...ref,uri:ref.filepath,source:'definition'}));
      let prompt=api.buildCompletionPrompt({text:sample.prefix+sample.suffix,offset:sample.prefix.length,maxCharacters:12000,filepath:sample.entryFilepath,model,snippets,comments:{line:sample.language==='python'?'#':'//'}});
      if(mode==='mercury-fim') {
        const [prefix,suffix] = sample.suffix ? api.getTemplateForModel(model).compilePrefixSuffix(sample.prefix,sample.suffix,
          'file:///'+sample.entryFilepath,'',[],[]) : [sample.prefix,sample.suffix];
        prompt=withContext||productionContext ? prompt : {prefix,suffix};
      }
      const raw=await api.requestCompletion({protocol:mode==='mercury-fim'?'fim':'siliconflow-fim',
        endpoint:mode==='mercury-fim'?'https://api.inceptionlabs.ai/v1/fim/completions':'https://api.siliconflow.cn/v1/chat/completions',
        model,apiKey:key,...prompt,maxTokens:256,signal:new AbortController().signal});
      record.raw=raw;record.insertion=api.prepareCompletion(raw,sample.prefix,sample.suffix,sample.language,model);
      record.formatAccepted=record.insertion!==undefined;
      if(record.formatAccepted)record.code=sample.prefix+record.insertion+sample.suffix;
    } else {
      const lines=sample.after.slice(0,sample.cursorOffset).split('\n');
      record.code=await api.requestNextEdit({context:{currentFilePath:sample.entryFilepath,currentFileContent:sample.after,cursorLine:lines.length-1,cursorCharacter:lines.at(-1).length,editableRegionStartLine:0,editableRegionEndLine:sample.after.split('\n').length-1,recentlyViewedSnippets:[],editDiffHistory:[createPatch(sample.entryFilepath,sample.before,sample.after,undefined,undefined,{context:1})]},maxContextCharacters:12000,endpoint:'https://api.inceptionlabs.ai/v1/edit/completions',model,apiKey:key,maxTokens:256,signal:new AbortController().signal});
      record.formatAccepted=true;
      record.exactExpected=record.code===sample.expected;
    }
  } catch(error) {record.error={name:error.name,code:error.code,status:error.status,message:error.message.replaceAll(key,'[redacted]')};}
  Object.assign(record,{status,outputTokenLimit,elapsedMs:Date.now()-started});records.push(record);
  writeFileSync(path.join(output,'results.json'),JSON.stringify({model,firstAttemptsOnly:true,records},null,2));
  console.log(JSON.stringify({id:record.id,status,elapsedMs:record.elapsedMs,formatAccepted:record.formatAccepted,exactExpected:record.exactExpected,error:record.error}));
  if(status===401 || status===402 || status===403)break;
}
