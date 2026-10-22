import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useContext } from 'react';
import { ExternalLink, FileSearch, FileText, Folder, Globe2, ListChecks, Sparkles, Wrench } from 'lucide-react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { CATEGORY_PRESENTATION, resultPreviewPolicy, toolPresentation } from '../../shared/transcript/toolCatalog';
import { toolResultSummaryLabel } from '../../shared/transcript/toolResultSummary';
import { resolveToolAction } from '../../shared/transcript/toolActivity';
import { classifyExploreTool } from './transcript/activityGrouping';
import { ProcessGroupContext, ProcessLatestContext, useProcessDisclosure } from './transcript/processPresentation';
import { canPreviewToolDiff, RESULT_UNAVAILABLE_COPY } from './transcript/toolRowPresentation';
import { formatDuration, formatToolLifecycle } from './thread/readers';
import { InlineDiffContext } from '../review/useInlineDiff';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { OperationDiff } from '../content/OperationDiff';
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
import { isScriptTool, readReceipt, scriptBackgroundReceipt } from '../../shared/transcript/scriptOutput';

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
  const { t } = useI18n();
  const actions = useToolActions();
  const inlineDiff = useContext(InlineDiffContext);
  const command = item.detailKind === 'command' ? item.detail : undefined;
  const running = item.status === 'running';
  const inline = useContext(ProcessGroupContext);
  const latest = useContext(ProcessLatestContext);
  const disclosure = useProcessDisclosure(messageId, `tool:${item.toolUseId}`, command !== undefined && running && !inline && !latest, inline);
  const category = classifyExploreTool(item.toolName);
  const exploration = item.detailKind === undefined && !item.subagent && !item.backgroundHint?.fireAndForget;
  const available = item.resultPreview?.availability === 'available' ? item.resultPreview : null;
  const errorMessage = item.errorMessage?.replace(/^([ \t]*Error:[ \t]*)(?:Error:[ \t]*)+/i, '$1');
  const target = item.filePath ?? item.target ?? (item.resultPreview?.source?.path === 'Tool result' ? undefined : item.resultPreview?.source?.path);
  const remoteResult = item.toolName === 'WebSearch' || item.toolName === 'github___get_file_contents';
  const action = exploration && category && target && !remoteResult ? CATEGORY_PRESENTATION[category].action : resolveToolAction(item.toolName, item.action);
  const resultSource = item.resultPreview?.source;
  const resultPresentation = resultSource ? toolPresentation(resultSource.tool) : undefined;
  const currentFile = item.filePath ?? (resultSource && resultSource.path !== '.' &&
    (resultPresentation?.target === 'file' || resultPresentation?.preview === 'diagnostics') ? resultSource.path : undefined);
  const unavailable = item.resultPreview?.availability === 'unavailable' ? RESULT_UNAVAILABLE_COPY[item.resultPreview.reason]
    : !item.resultPreview && item.status === 'completed' && !errorMessage && resultPreviewPolicy(item.toolName) !== 'none' ? RESULT_UNAVAILABLE_COPY['not-saved'] : null;
  const diff = item.operationDiff !== undefined || (inlineDiff !== null && canPreviewToolDiff(item.toolName, item.status, item.filePath, item.turnId));
  const commandOutput = item.outputTail ?? (command !== undefined ? available?.text : undefined);
  const output = command !== undefined && item.status === 'failed' && errorMessage
    ? commandOutput ? `${commandOutput}\n${errorMessage.split(/\r?\n/, 1)[0]}` : errorMessage
    : commandOutput;
  const receipt = available && !available.truncated && resultPresentation?.target === 'file' ? readReceipt(available.text) : undefined;
  const background = available && !available.truncated && isScriptTool(item.toolName) ? scriptBackgroundReceipt(available.text) : undefined;
  const compactResult = receipt ? t('Read lines {start}–{end} ({size})', receipt)
    : background ? t('Started in background · PID {pid}', background) : undefined;
  const previewBody = available !== null && compactResult === undefined;
  const resultNotice = !output && !errorMessage ? unavailable : null;
  const hasDetails = command !== undefined || previewBody || !!output || !!errorMessage || (!exploration && !!item.detail);
  const state = executionLabel(item) ?? (item.status === 'completed' ? '' : item.status === 'stopping' ? 'Stopping' : formatToolLifecycle(item.status));
  const resultSummary = item.status === 'completed' && item.resultPreview?.summary ? toolResultSummaryLabel(item.resultPreview.summary) : '';
  const status = [t(state), item.durationMs === undefined ? '' : formatDuration(item.durationMs), compactResult,
    resultNotice ? t(resultNotice.label) : ''].filter(Boolean).join(' · ');
  const title = `${t(action)}${target ? ` · ${target}` : ''}`;
  const activityActions = <>
    {currentFile && actions.openPath ? <Button variant="ghost" size="icon-sm" className="size-6" title={t("Open {p0}", { p0: currentFile })} aria-label={t("Open current file")}
      onClick={() => actions.openPath!({ path: currentFile })}><ExternalLink className="size-3" /></Button> : null}
  </>;
  const fileActions = <>
    {currentFile && actions.openPath ? <Button variant="link" size="sm" className="h-auto select-none px-1 text-[11px]" title={t("Open {p0}", { p0: currentFile })} aria-label={t("Open current file")} onClick={() => actions.openPath!({ path: currentFile })}>{currentFile.split(/[\\/]/).at(-1)}</Button> : null}
  </>;
  const activityDetail = previewBody || !!output || !!errorMessage ? <>
    {previewBody ? <ActivityResult preview={available!} /> : null}
    {output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--panel-edge)] bg-muted/25 p-2.5 font-mono text-[11px] leading-[18px]">{output}</pre> : null}
    {errorMessage ? <p role="status" className="v2-tool-error">{errorMessage}</p> : null}
  </> : undefined;
  if (item.subagent) {
    const delegationFailed = item.status === 'failed' && item.subagent.status !== 'failed';
    const errorSummary = [delegationFailed ? t('Delegation failed') : '', errorMessage?.split(/\r?\n/, 1)[0]].filter(Boolean).join(' · ');
    return <div className="min-w-0 space-y-1">
      <SubagentRow item={item} />
      {errorSummary ? <p role="status" className="px-2 text-[11px] text-destructive [overflow-wrap:anywhere]">{errorSummary}</p> : null}
      {hasDetails ? <Tool open={disclosure.expanded} onOpenChange={() => disclosure.toggle()} className="px-2">
        <div className="flex min-w-0 items-center gap-1">
          <ToolHeader title={t("Task details")} status="" />
          {fileActions}
        </div>
        <ToolContent className="space-y-1 pb-1">
          <p data-ui-notice="">{[title, status].filter(Boolean).join(' · ')}</p>
          {resultSummary ? <p data-ui-notice="">{resultSummary}</p> : null}
          {item.detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre> : null}
          {activityDetail}
        </ToolContent>
      </Tool> : null}
      {diff ? <OperationDiff item={item} messageId={messageId} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
      {item.backgroundHint?.fireAndForget ? <p data-ui-notice="" className="px-2 text-[11px] text-muted-foreground">{t("Background process · Keeps running until you stop it manually")}</p> : null}
    </div>;
  }
  if (isFoldableFileOperation(item)) {
    return <OperationDiff item={item} messageId={messageId} onInteract={onInteract} />;
  }
  if (item.detailKind === 'plan' && item.detail) {
    const steps = parsePlanSteps(item.detail);
    return <ActivityItem id={item.id} messageId={messageId} icon={<ListChecks />} title={t("Task plan")}
      status={`${steps.filter((step) => step.status === 'completed').length} / ${steps.length}${state ? ` · ${state}` : ''}`}>
      <PlanSteps steps={steps} />
      {errorMessage ? <p role="status" className="v2-tool-error">{errorMessage}</p> : null}
    </ActivityItem>;
  }
  if ((grouped && exploration) || (inline && command === undefined)) return <div className="space-y-1" title={[item.toolName, unavailable ? t(unavailable.detail) : undefined, background?.log].filter(Boolean).join(' · ')}>
    <ActivityItem id={item.id} messageId={messageId} icon={activityIcon(category)} title={action} target={target}
      status={status || undefined} failed={item.status === 'failed'} description={resultSummary || undefined} actions={activityActions}>
      {!exploration && item.detail ? <><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre>{activityDetail}</> : activityDetail}
    </ActivityItem>
    {diff ? <OperationDiff item={item} messageId={messageId} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
    {item.backgroundHint?.fireAndForget ? <p data-ui-notice="" className="pl-6 text-[10.5px] text-muted-foreground">{t("Background process · Keeps running until you stop it manually")}</p> : null}
  </div>;
  return <div className="space-y-1" title={[item.toolName, unavailable?.detail].filter(Boolean).join(' · ')}>
    {command !== undefined ? <CommandCard item={item} command={command} output={output} open={disclosure.expanded}
      onOpenChange={disclosure.toggle} fileActions={fileActions} /> : <Tool open={disclosure.expanded && hasDetails} onOpenChange={() => disclosure.toggle()}>
      <div data-ui-notice="" className="flex min-w-0 select-none items-center gap-1">
        {hasDetails ? <ToolHeader title={title} status={status} /> : <div className="flex min-w-0 flex-1 items-center gap-2 py-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate" title={title}>{title}</span><span className="shrink-0">{status}</span></div>}
        {fileActions}
      </div>
      {resultSummary ? <p data-ui-notice="" className="truncate pl-4 text-[11px] text-muted-foreground" title={resultSummary}>{resultSummary}</p> : null}
      <ToolContent className="space-y-1 pb-1">
        {previewBody ? <ActivityResult preview={available!} /> : null}
        {!exploration && item.detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{item.detail}</pre> : null}
        {output ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{output}</pre> : null}
        {errorMessage ? <p role="status" className="v2-tool-error">{errorMessage}</p> : null}
      </ToolContent>
    </Tool>}
    {diff ? <OperationDiff item={item} messageId={messageId} hideConfirmed={hideConfirmedOperations} onInteract={onInteract} /> : null}
    {item.backgroundHint?.fireAndForget ? <p data-ui-notice="" className="pl-4 text-[11px] text-muted-foreground">{t("Background process · Keeps running until you stop it manually")}</p> : null}
  </div>;
}
