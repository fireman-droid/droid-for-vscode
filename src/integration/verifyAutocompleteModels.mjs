import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2];
if(!['fim','next-edit'].includes(mode)||!process.argv.includes('--reviewed'))throw new Error('Review every generated program first, then pass fim|next-edit --reviewed');
const dir=path.join(root,'artifacts/autocomplete-models',mode);
const report=JSON.parse(readFileSync(path.join(dir,'results.json'),'utf8'));
const samples=JSON.parse(readFileSync(path.join(root,'src/integration/fixtures',mode==='fim'?'autocompleteSamples.json':'nextEditSamples.json'),'utf8'));
function run(exe,args,cwd){return execFileSync(exe,args,{cwd,encoding:'utf8',timeout:30000,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,LOCALAPPDATA:process.env.LOCALAPPDATA,GO111MODULE:'off',GOWORK:'off',GOPROXY:'off',GOSUMDB:'off'}}).trim();}
const reviewedVariants={"go-function-body":"  for i, v := range values {\n    total += (i + 1) * v\n  }\n","go-eof":"\t// prefix\n\tif value < 0 {\n\t\tvalue = -value\n\t}\n\tsum := 0\n\tfor value > 0 {\n\t\tsum += value % 10\n\t\tvalue /= 10\n\t}\n\t// suffix\n\treturn sum\n}","java-eof":"    int sum = 0;\n    for (int i = 1; i <= n; i++) {\n      sum += i * i;\n    }\n    return sum;\n  }\n}","typescript-eof":"    // Convert to string, remove negative sign if present, then sum digits\n    return Math.abs(value)\n        .toString()\n        .split('')\n        .reduce((sum, digit) => sum + parseInt(digit, 10), 0);\n}"};
const results=[];
for(const record of report.records){
 const sample=samples.find(s=>s.id===record.id),out=path.join(dir,'programs',record.id);mkdirSync(out,{recursive:true});
 try{
  if(typeof record.code!=='string')throw new Error('No valid model suggestion');
  const compact = text => text.replace(/\s/g,'');
  if(mode==='next-edit' ? record.code!==sample.expected
    : ![sample.expectedInsertion,reviewedVariants[record.id]].some(s=>typeof s==='string'&&compact(s)===compact(record.insertion??'')) ||
       record.code!==sample.prefix+record.insertion+sample.suffix) {
    throw new Error('Generated program differs from the reviewed fixture; execution refused');
  }

  const files=[{filepath:sample.entryFilepath,content:record.code},...(sample.references??[])];
  if(sample.verificationSource)files.push({filepath:sample.verificationFilepath,content:sample.verificationSource});
  for(const f of files)writeFileSync(path.join(out,f.filepath),f.content);
  let output;
  if(sample.language==='go')output=run('go',['run',...files.map(f=>f.filepath)],out);
  else if(sample.language==='java'){run('javac',['-encoding','UTF-8','-d','classes',...files.map(f=>f.filepath)],out);output=run('java',['-cp','classes',sample.verificationSource?'Verification':'CompletionSample'],out);}
  else if(sample.language==='python')output=run('python',[sample.entryFilepath],out);
  else {
    const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,skipLibCheck:true,types:[],noEmitOnError:true,outDir:path.join(out,'compiled')};
    const program=ts.createProgram(files.map(f=>path.join(out,f.filepath)),options);
    const emitted=program.emit(),diagnostics=[...ts.getPreEmitDiagnostics(program),...emitted.diagnostics];
    if(emitted.emitSkipped||diagnostics.length)throw new Error(ts.formatDiagnostics(diagnostics,{getCurrentDirectory:()=>out,getCanonicalFileName:f=>f,getNewLine:()=>'\n'}));
    writeFileSync(path.join(out,'package.json'),'{"type":"commonjs"}');
    output=run(process.execPath,[path.join('compiled',sample.verificationSource?'verification.js':'main.js')],out);
  }
  const expected=mode==='fim'?'PASS '+sample.id+' '+sample.expectedValues.join(' '):sample.expectedOutput;
  if(output!==expected)throw new Error('Expected '+JSON.stringify(expected)+', received '+JSON.stringify(output));
  results.push({id:sample.id,passed:true});
 } catch(error){results.push({id:sample.id,passed:false,error:error.message});}
}
writeFileSync(path.join(dir,'verified.json'),JSON.stringify(results,null,2));
const timings=report.records.map(r=>r.elapsedMs).sort((a,b)=>a-b);
console.log(JSON.stringify({mode,requests:report.records.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed),medianMs:timings[Math.floor(timings.length/2)],p95Ms:timings[Math.ceil(timings.length*.95)-1]}));
if(results.some(r=>!r.passed))process.exitCode=1;
