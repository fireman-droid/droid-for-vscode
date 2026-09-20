import { useContext } from 'react';
import { ExternalLink, FileSearch, FileText, Folder, Globe2, ListChecks, Sparkles } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { RESULT_TOOLS } from '../../shared/transcript/toolResultPreview';
import { isPreviewableFilePath } from '../../shared/validation/guards';
import { classifyExploreTool } from '../../webview/assistant/transcript/activityGrouping';
import { useProcessDisclosure } from '../../webview/assistant/transcript/processPresentation';
import { canPreviewToolDiff, EXPLORE_ACTIONS, RESULT_UNAVAILABLE_COPY } from '../../webview/assistant/transcript/toolRowPresentation';
import { formatDuration, formatToolLifecycle } from '../../webview/assistant/thread/readers';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
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
import { parsePlanSteps } from '../../webview/assistant/transcript/planAnchor';
import { PlanSteps } from './PlanLine';

function activityIcon(category: ReturnType<typeof classifyExploreTool>) {
  if (category === 'file') return <FileText />;
  if (category === 'folder') return <Folder />;
  if (category === 'search') return <FileSearch />;
  if (category === 'fetch') return <Globe2 />;
  if (category === 'skill') return <Sparkles />;
  return <ListChecks />;
}

export function ToolRow({ item, messageId, grouped = false }: { readonly item: ToolTranscriptItem; readonly messageId: string; readonly grouped?: boolean }) {
  const actions = useToolActions();
  const content = useContent();
  const inlineDiff = useContext(InlineDiffContext);
  const command = item.detailKind === 'command' ? item.detail : undefined;
  const running = item.status === 'running';
  const disclosure = useProcessDisclosure(messageId, `tool:${item.toolUseId}`, command !== undefined && running);
  const category = classifyExploreTool(item.toolName);
  const exploration = (category !== null || item.filePath !== undefined) && item.detailKind === undefined && !item.subagent && !item.backgroundHint?.fireAndForget;
  const action = exploration && category ? EXPLORE_ACTIONS[category] : item.action;
  const available = item.resultPreview?.availability === 'available' ? item.resultPreview : null;
  const errorMessage = item.errorMessage?.replace(/^([ \t]*Error:[ \t]*)(?:Error:[ \t]*)+/i, '$1');
  const target = item.filePath ?? item.target ?? item.resultPreview?.source?.path;
  const currentFile = item.filePath ?? (available?.source.tool === 'Read' ? available.source.path : undefined);
  const unavailable = item.resultPreview?.availability === 'unavailable' ? RESULT_UNAVAILABLE_COPY[item.resultPreview.reason]
    : !item.resultPreview && item.status === 'completed' && !errorMessage && RESULT_TOOLS.some((name) => name === item.toolName) ? RESULT_UNAVAILABLE_COPY['not-saved'] : null;
  const diff = item.operationDiff !== undefined || (inlineDiff !== null && canPreviewToolDiff(item.toolName, item.status, item.filePath, item.turnId));
  const output = command !== undefined && item.status === 'failed' && errorMessage
    ? item.outputTail ? `${item.outputTail}\n${errorMessage.split(/\r?\n/, 1)[0]}` : errorMessage
    : item.outputTail;
  const hasDetails = command !== undefined || available !== null || !!output || !!errorMessage || (!exploration && !!item.detail);
  const state = executionLabel(item) ?? (item.status === 'completed' ? '' : item.status === 'stopping' ? 'Stopping' : formatToolLifecycle(item.status));
  const status = [state, item.durationMs === undefined ? '' : formatDuration(item.durationMs)].filter(Boolean).join(' · ');
  const title = `${action}${target ? ` · ${target}` : exploration ? ' · Target not recorded' : ''}`;
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
  const activityDetail = available !== null || !!output || !!errorMessage ? <>
    {available ? <ActivityResult preview={available} /> : null}
    {output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--panel-edge)] bg-muted/25 p-2.5 font-mono text-[11px] leading-[18px]">{output}</pre> : null}
    {errorMessage ? <pre role="status" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-2.5 font-mono text-[11px] leading-[18px] text-destructive">{errorMessage}</pre> : null}
  </> : undefined;
  if (item.detailKind === 'plan' && item.detail) {
    const steps = parsePlanSteps(item.detail);
    return <ActivityItem id={item.id} messageId={messageId} icon={<ListChecks />} title="Updated todos"
      status={`${steps.filter((step) => step.status === 'completed').length} / ${steps.length}${state ? ` · ${state}` : ''}`}>
      <PlanSteps steps={steps} />
      {errorMessage ? <p role="status" className="text-destructive">{errorMessage}</p> : null}
    </ActivityItem>;
  }
  if (grouped && exploration) return <div className="space-y-1">
    <ActivityItem id={item.id} messageId={messageId} icon={activityIcon(category)} title={action} target={target ?? 'Target not recorded'}
      status={[status, unavailable?.label].filter(Boolean).join(' · ') || undefined} actions={activityActions}>
      {activityDetail}
    </ActivityItem>
    {diff ? <OperationDiff item={item} /> : null}
    {item.backgroundHint?.fireAndForget ? <p className="pl-6 text-[10.5px] text-muted-foreground">Background process · Keeps running until you stop it manually</p> : null}
    {item.subagent ? <SubagentRow item={item} /> : null}
  </div>;
  return <div className="space-y-1">
    {command !== undefined ? <CommandCard item={item} command={command} output={output} open={disclosure.expanded}
      onOpenChange={disclosure.toggle} fileActions={fileActions} /> : <Tool open={disclosure.expanded && hasDetails} onOpenChange={() => disclosure.toggle()}>
      <div className="flex min-w-0 select-none items-center gap-1">
        {hasDetails ? <ToolHeader title={title} status={status} /> : <div className="flex min-w-0 flex-1 items-center gap-2 py-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate" title={title}>{title}</span><span className="shrink-0">{status}</span></div>}
        {fileActions}
      </div>
      {unavailable ? <p title={unavailable.detail} className="select-none pl-4 text-[11px] text-muted-foreground">{unavailable.label}</p> : null}
      <ToolContent className="space-y-1 pb-1">
        {available ? <div><p className="mb-1 select-none text-[11px]">Result snippet{available.truncated ? ' · truncated' : ''}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{available.text}</pre></div> : null}
        {!exploration && item.detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre> : null}
        {output ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{output}</pre> : null}
        {errorMessage ? <p role="status" className="whitespace-pre-wrap break-words text-destructive">{errorMessage}</p> : null}
      </ToolContent>
    </Tool>}
    {diff ? <OperationDiff item={item} /> : null}
    {item.backgroundHint?.fireAndForget ? <p className="pl-4 text-[11px] text-muted-foreground">Background process · Keeps running until you stop it manually</p> : null}
    {item.subagent ? <SubagentRow item={item} /> : null}
  </div>;
}
