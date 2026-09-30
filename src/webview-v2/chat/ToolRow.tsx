import { useContext } from 'react';
import { ExternalLink, FileSearch, FileText, Folder, Globe2, ListChecks, Sparkles, Wrench } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { CATEGORY_PRESENTATION, resultPreviewPolicy, toolPresentation } from '../../shared/transcript/toolCatalog';
import { toolResultSummaryLabel } from '../../shared/transcript/toolResultSummary';
import { resolveToolAction } from '../../shared/transcript/toolActivity';
import { isPreviewableFilePath } from '../../shared/validation/guards';
import { classifyExploreTool } from './transcript/activityGrouping';
import { useProcessDisclosure } from './transcript/processPresentation';
import { canPreviewToolDiff, RESULT_UNAVAILABLE_COPY } from './transcript/toolRowPresentation';
import { formatDuration, formatToolLifecycle } from './thread/readers';
import { InlineDiffContext } from '../review/useInlineDiff';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { OperationDiff } from '../content/OperationDiff';
import { useContent } from '../content/context';
import { useToolActions } from '../content/toolActions';
import { Button } from '../ui/button';
import { CommandCard } from './CommandCard';
import { SubagentRow } from './SubagentRow';
import { executionLabel } from '../content/operationPresentation';
import { ActivityItem } from './ActivityItem';
import { ActivityResult } from './ActivityResult';
import { parsePlanSteps } from './transcript/planAnchor';
import { PlanSteps } from './PlanLine';
import { isFoldableFileOperation } from './operationSummary';

function activityIcon(category: ReturnType<typeof classifyExploreTool>) {
  if (category === 'file') return <FileText />;
  if (category === 'folder') return <Folder />;
  if (category === 'search') return <FileSearch />;
  if (category === 'fetch') return <Globe2 />;
  if (category === 'skill') return <Sparkles />;
  if (category === 'diagnostics' || category === 'task-check') return <ListChecks />;
  return <Wrench />;
}

export function ToolRow({ item, messageId, grouped = false, hideConfirmedOperations = false, onInteract }: { readonly item: ToolTranscriptItem; readonly messageId: string; readonly grouped?: boolean; readonly hideConfirmedOperations?: boolean; readonly onInteract?: () => void }) {
  const actions = useToolActions();
  const content = useContent();
  const inlineDiff = useContext(InlineDiffContext);
  const command = item.detailKind === 'command' ? item.detail : undefined;
  const running = item.status === 'running';
  const disclosure = useProcessDisclosure(messageId, `tool:${item.toolUseId}`, command !== undefined && running);
  const category = classifyExploreTool(item.toolName);
  const exploration = item.detailKind === undefined && !item.subagent && !item.backgroundHint?.fireAndForget;
  const available = item.resultPreview?.availability === 'available' ? item.resultPreview : null;
  const errorMessage = item.errorMessage?.replace(/^([ \t]*Error:[ \t]*)(?:Error:[ \t]*)+/i, '$1');
  const target = item.filePath ?? item.target ?? item.resultPreview?.source?.path;
  const remoteResult = item.toolName === 'WebSearch' || item.toolName === 'github___get_file_contents';
  const action = exploration && category && target && !remoteResult ? CATEGORY_PRESENTATION[category].action : resolveToolAction(item.toolName, item.action);
  const resultSource = item.resultPreview?.source;
  const resultPresentation = resultSource ? toolPresentation(resultSource.tool) : undefined;
  const currentFile = item.filePath ?? (resultSource && resultSource.path !== '.' &&
    (resultPresentation?.target === 'file' || resultPresentation?.preview === 'diagnostics') ? resultSource.path : undefined);
  const unavailable = item.resultPreview?.availability === 'unavailable' ? RESULT_UNAVAILABLE_COPY[item.resultPreview.reason]
    : !item.resultPreview && item.status === 'completed' && !errorMessage && resultPreviewPolicy(item.toolName) !== 'none' ? RESULT_UNAVAILABLE_COPY['not-saved'] : null;
  const diff = item.operationDiff !== undefined || (inlineDiff !== null && canPreviewToolDiff(item.toolName, item.status, item.filePath, item.turnId));
  const output = command !== undefined && item.status === 'failed' && errorMessage
    ? item.outputTail ? `${item.outputTail}\n${errorMessage.split(/\r?\n/, 1)[0]}` : errorMessage
    : item.outputTail;
  const hasDetails = command !== undefined || available !== null || unavailable !== null || !!output || !!errorMessage || (!exploration && !!item.detail);
  const state = executionLabel(item) ?? (item.status === 'completed' ? '' : item.status === 'stopping' ? 'Stopping' : formatToolLifecycle(item.status));
  const resultSummary = item.status === 'completed' && item.resultPreview?.summary ? toolResultSummaryLabel(item.resultPreview.summary) : '';
  const status = [state, item.durationMs === undefined ? '' : formatDuration(item.durationMs)].filter(Boolean).join(' · ');
  const title = `${action}${target ? ` · ${target}` : ''}`;
  const activityActions = <>
    {currentFile && actions.openPath ? <Button variant="ghost" size="icon-sm" className="size-6" title={`Open ${currentFile}`} aria-label="Open current file"
      onClick={() => actions.openPath!({ path: currentFile })}><ExternalLink className="size-3" /></Button> : null}
    {item.filePath && item.status === 'completed' && isPreviewableFilePath(item.filePath) && content.actions?.previewFile
      ? <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10.5px]" onClick={() => content.actions!.previewFile?.(item.filePath!)}>Canvas</Button> : null}
  </>;
  const fileActions = <>
    {currentFile && actions.openPath ? <Button variant="link" size="sm" className="h-auto select-none px-1 text-[11px]" title={`Open ${currentFile}`} aria-label="Open current file" onClick={() => actions.openPath!({ path: currentFile })}>{currentFile.split(/[\\/]/).at(-1)}</Button> : null}
    {item.filePath && item.status === 'completed' && isPreviewableFilePath(item.filePath) && content.actions?.previewFile ? <Button variant="ghost" size="sm" onClick={() => content.actions!.previewFile?.(item.filePath!)}>Canvas</Button> : null}
  </>;
  const activityDetail = available !== null || unavailable !== null || !!output || !!errorMessage ? <>
    {available ? <ActivityResult preview={available} /> : null}
    {output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--panel-edge)] bg-muted/25 p-2.5 font-mono text-[11px] leading-[18px]">{output}</pre> : null}
    {errorMessage ? <pre role="status" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-2.5 font-mono text-[11px] leading-[18px] text-destructive">{errorMessage}</pre> : null}
    {unavailable ? <p className="text-[11px] text-muted-foreground">{unavailable.detail}</p> : null}
  </> : undefined;
  if (item.subagent) {
    const delegationFailed = item.status === 'failed' && item.subagent.status !== 'failed';
    const errorSummary = [delegationFailed ? 'Delegation failed' : '', errorMessage?.split(/\r?\n/, 1)[0]].filter(Boolean).join(' · ');
    return <div className="min-w-0 space-y-1">
      <SubagentRow item={item} />
      {errorSummary ? <p role="status" className="px-2 text-[11px] text-destructive [overflow-wrap:anywhere]">{errorSummary}</p> : null}
      {hasDetails ? <Tool open={disclosure.expanded} onOpenChange={() => disclosure.toggle()} className="px-2">
        <div className="flex min-w-0 items-center gap-1">
          <ToolHeader title="Task details" status="" />
          {fileActions}
        </div>
        <ToolContent className="space-y-1 pb-1">
          <p>{[title, status].filter(Boolean).join(' · ')}</p>
          {resultSummary ? <p>{resultSummary}</p> : null}
          {item.detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre> : null}
          {activityDetail}
        </ToolContent>
      </Tool> : null}
      {diff ? <OperationDiff item={item} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
      {item.backgroundHint?.fireAndForget ? <p className="px-2 text-[11px] text-muted-foreground">Background process · Keeps running until you stop it manually</p> : null}
    </div>;
  }
  if (isFoldableFileOperation(item)) return hideConfirmedOperations ? null : <OperationDiff item={item} onInteract={onInteract} />;
  if (item.detailKind === 'plan' && item.detail) {
    const steps = parsePlanSteps(item.detail);
    return <ActivityItem id={item.id} messageId={messageId} icon={<ListChecks />} title="Task plan"
      status={`${steps.filter((step) => step.status === 'completed').length} / ${steps.length}${state ? ` · ${state}` : ''}`}>
      <PlanSteps steps={steps} />
      {errorMessage ? <p role="status" className="text-destructive">{errorMessage}</p> : null}
    </ActivityItem>;
  }
  if (grouped && exploration) return <div className="space-y-1" title={[item.toolName, unavailable?.detail].filter(Boolean).join(' · ')}>
    <ActivityItem id={item.id} messageId={messageId} icon={activityIcon(category)} title={action} target={target}
      status={status || undefined} description={resultSummary || undefined} actions={activityActions}>
      {activityDetail}
    </ActivityItem>
    {diff ? <OperationDiff item={item} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
    {item.backgroundHint?.fireAndForget ? <p className="pl-6 text-[10.5px] text-muted-foreground">Background process · Keeps running until you stop it manually</p> : null}
  </div>;
  return <div className="space-y-1" title={[item.toolName, unavailable?.detail].filter(Boolean).join(' · ')}>
    {command !== undefined ? <CommandCard item={item} command={command} output={output} open={disclosure.expanded}
      onOpenChange={disclosure.toggle} fileActions={fileActions} /> : <Tool open={disclosure.expanded && hasDetails} onOpenChange={() => disclosure.toggle()}>
      <div className="flex min-w-0 select-none items-center gap-1">
        {hasDetails ? <ToolHeader title={title} status={status} /> : <div className="flex min-w-0 flex-1 items-center gap-2 py-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate" title={title}>{title}</span><span className="shrink-0">{status}</span></div>}
        {fileActions}
      </div>
      {resultSummary ? <p className="truncate pl-4 text-[11px] text-muted-foreground" title={resultSummary}>{resultSummary}</p> : null}
      <ToolContent className="space-y-1 pb-1">
        {available ? <ActivityResult preview={available} /> : null}
        {!exploration && item.detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre> : null}
        {output ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{output}</pre> : null}
        {errorMessage ? <p role="status" className="whitespace-pre-wrap break-words text-destructive">{errorMessage}</p> : null}
        {unavailable ? <p className="text-[11px] text-muted-foreground">{unavailable.detail}</p> : null}
      </ToolContent>
    </Tool>}
    {diff ? <OperationDiff item={item} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
    {item.backgroundHint?.fireAndForget ? <p className="pl-4 text-[11px] text-muted-foreground">Background process · Keeps running until you stop it manually</p> : null}
  </div>;
}
