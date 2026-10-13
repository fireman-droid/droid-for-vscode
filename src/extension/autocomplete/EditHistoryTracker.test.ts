import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({docs:[] as unknown[],listeners:new Map<string,(event:any)=>void>()}));
vi.mock('vscode',()=>({window:{onDidChangeActiveTextEditor:()=>({dispose:()=>{}})},workspace:{
 get textDocuments(){return state.docs;},asRelativePath:(uri:{fsPath:string})=>uri.fsPath,
 onDidOpenTextDocument:(f:(e:any)=>void)=>{state.listeners.set('open',f);return{dispose:()=>{}};},
 onDidCloseTextDocument:(f:(e:any)=>void)=>{state.listeners.set('close',f);return{dispose:()=>{}};},
 onDidChangeTextDocument:(f:(e:any)=>void)=>{state.listeners.set('change',f);return{dispose:()=>{}};},
}}));
import {EditHistoryTracker} from './kilo/next-edit/editHistoryTracker';
function doc(file='main.ts'){let text='const oldName = 1;\n';const d={uri:{scheme:'file',fsPath:file},isClosed:false,getText:()=>text};state.docs.push(d);return{d,set:(value:string)=>{text=value;state.listeners.get('change')?.({document:d,contentChanges:[{}]});}};}
beforeEach(()=>{vi.useFakeTimers();state.docs=[];state.listeners.clear();});
afterEach(()=>vi.useRealTimers());
describe('Next Edit history lifecycle',()=>{
 it('includes pending dependency edits before the latest active-file edit without waiting for debounce',async()=>{
  const dependency=doc('types.ts'),entry=doc(),onError=vi.fn();
  const history=new EditHistoryTracker({isFileAllowed:async()=>true,onError});
  await vi.advanceTimersByTimeAsync(0);
  dependency.set('const dependencyName = 1;\n');
  entry.set('const callSiteName = 1;\n');
  await history.flush(entry.d as never);
  const diffs=await history.getRecentDiffs();
  expect(diffs).toHaveLength(2);
  expect(diffs[0]).toContain('+const dependencyName');
  expect(diffs[1]).toContain('+const callSiteName');
  await vi.advanceTimersByTimeAsync(2000);
  expect(await history.getRecentDiffs()).toEqual(diffs);
  expect(onError).not.toHaveBeenCalled();history.dispose();
 });
 it('keeps the latest edits by edit order when their diffs are emitted out of order',async()=>{
  const oldest=doc('oldest.ts'),middle=doc('middle.ts'),latest=doc('latest.ts');
  const history=new EditHistoryTracker({isFileAllowed:async()=>true,onError:vi.fn(),maxDiffs:2});
  await vi.advanceTimersByTimeAsync(0);
  oldest.set('const first = 1;\n');middle.set('const second = 1;\n');latest.set('const third = 1;\n');
  await history.flush(latest.d as never);await history.flush(middle.d as never);
  const diffs=await history.getRecentDiffs();
  expect(diffs).toHaveLength(2);expect(diffs[0]).toContain('+const second');expect(diffs[1]).toContain('+const third');
  history.dispose();
 });
 it.each(['file','untitled'])('captures %s edits and removes history when policy excludes the source',async(scheme)=>{
  const file=doc(),allowed=vi.fn(async()=>true),error=vi.fn();file.d.uri.scheme=scheme;
  const history=new EditHistoryTracker({isFileAllowed:allowed,onError:error});
  await vi.advanceTimersByTimeAsync(0);
  file.set('const newName = 1;\n'); await history.flush(file.d as never);
  const diffs=await history.getRecentDiffs(); expect(diffs).toHaveLength(1);
  expect(diffs[0]).toContain('-const oldName');expect(diffs[0]).toContain('+const newName');
  allowed.mockResolvedValue(false);expect(await history.getRecentDiffs()).toEqual([]);
  expect(error).not.toHaveBeenCalled();history.dispose();
 });
 it('does not retain a snapshot when an asynchronous policy check completes after disposal',async()=>{
  const file=doc();let resolve!:(v:boolean)=>void;
  const history=new EditHistoryTracker({isFileAllowed:()=>new Promise<boolean>(r=>resolve=r),onError:vi.fn()});
  history.dispose();resolve(true);await vi.advanceTimersByTimeAsync(0);
  expect(await history.getRecentDiffs()).toEqual([]);file.set('secret');expect(vi.getTimerCount()).toBe(0);
 });
 it('reports asynchronous policy failures at the host boundary',async()=>{
  doc();const onError=vi.fn(),failure=new Error('policy read');
  const history=new EditHistoryTracker({isFileAllowed:async()=>{throw failure;},onError});
  await vi.advanceTimersByTimeAsync(0);expect(onError).toHaveBeenCalledWith(failure);history.dispose();
 });
});
