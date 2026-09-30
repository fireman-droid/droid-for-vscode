import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({docs:[] as unknown[],listeners:new Map<string,(event:any)=>void>()}));
vi.mock('vscode',()=>({window:{onDidChangeActiveTextEditor:()=>({dispose:()=>{}})},workspace:{
 get textDocuments(){return state.docs;},asRelativePath:(uri:{fsPath:string})=>uri.fsPath,
 onDidOpenTextDocument:(f:(e:any)=>void)=>{state.listeners.set('open',f);return{dispose:()=>{}};},
 onDidCloseTextDocument:(f:(e:any)=>void)=>{state.listeners.set('close',f);return{dispose:()=>{}};},
 onDidChangeTextDocument:(f:(e:any)=>void)=>{state.listeners.set('change',f);return{dispose:()=>{}};},
}}));
import {EditHistoryTracker} from './kilo/next-edit/editHistoryTracker';
function doc(){let text='const oldName = 1;\n';const d={uri:{scheme:'file',fsPath:'main.ts'},isClosed:false,getText:()=>text};state.docs=[d];return{d,set:(value:string)=>{text=value;state.listeners.get('change')?.({document:d,contentChanges:[{}]});}};}
beforeEach(()=>{vi.useFakeTimers();state.docs=[];state.listeners.clear();});
afterEach(()=>vi.useRealTimers());
describe('Next Edit history lifecycle',()=>{
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
