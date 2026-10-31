import { Check, ChevronRight, CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { DroidActivity } from '../ui/droid-motion';
import { CodeBlock } from '../content/CodeBlock';
import { ActivityItem } from './ActivityItem';
import type { SideToolActivity } from './sideChat';

export const SIDE_TOOL_LABELS = {
  read: ['Reading code…', 'Read code'], search: ['Searching…', 'Search'],
  web: ['Looking up documentation…', 'Look up documentation'], git: ['Querying Git…', 'Git query'],
  analysis: ['Running example…', 'Run example'], other: ['Using tools…', 'Tool'],
} as const;

function StatusIcon({ state }: { readonly state: SideToolActivity['state'] }) {
  if (state === 'running') return <DroidActivity phase="working" />;
  const Icon = state === 'done' ? Check : state === 'error' ? CircleAlert : CircleDashed;
  return <Icon aria-hidden="true" />;
}

export function summarizeSideTools(tools: readonly SideToolActivity[], t: ReturnType<typeof useI18n>['t']): string {
  let reads = 0, searches = 0, fetches = 0, git = 0, others = 0;
  for (const tool of tools) {
    if (tool.kind === 'read') reads += 1;
    else if (tool.kind === 'search') searches += 1;
    else if (tool.kind === 'web') fetches += 1;
    else if (tool.kind === 'git') git += 1;
    else others += 1;
  }
  const parts: string[] = [];
  if (reads > 0) parts.push(t(reads === 1 ? '{count} read' : '{count} reads', { count: reads }));
  if (searches > 0) parts.push(t(searches === 1 ? '{count} search' : '{count} searches', { count: searches }));
  if (fetches > 0) parts.push(t(fetches === 1 ? '{count} fetch' : '{count} fetches', { count: fetches }));
  if (git > 0) parts.push(git > 1 ? `${t('Git query')} × ${git}` : t('Git query'));
  if (others > 0) parts.push(t(others === 1 ? '{count} operation' : '{count} operations', { count: others }));
  return parts.join(', ');
}

/** One tool row inside the shared process group; details open only when a result exists. */
export function SideToolItem({ messageId, tool }: { readonly messageId: string; readonly tool: SideToolActivity }) {
  const { t } = useI18n();
  const target = tool.target ?? (tool.kind === 'other' ? tool.name : undefined);
  const status = tool.state === 'error' ? t('Failed') : tool.state === 'incomplete' ? t('Result unconfirmed') : undefined;
  const details = tool.error || tool.output || tool.detailsOmitted ? <>
    {tool.error ? <p className="v2-btw-error">{tool.error}</p> : null}
    {tool.output ? <pre className="v2-btw-tool-output">{tool.output}</pre> : null}
    {tool.detailsOmitted ? <p data-ui-notice="" className="v2-btw-tool-note">{t('Some earlier or lengthy details were omitted.')}</p> : null}
  </> : undefined;
  return <ActivityItem id={tool.id} messageId={messageId} title={t(SIDE_TOOL_LABELS[tool.kind][tool.state === 'running' ? 0 : 1])}
    target={target} status={status} failed={tool.state === 'error'}>{details}</ActivityItem>;
}

function ToolDisclosure({ label, icon, children, failed = false }: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly failed?: boolean;
}) {
  return <Collapsible className="v2-btw-tool-record" defaultOpen={failed}>
    <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-btw-tool-toggle" data-failed={failed || undefined}>
      <ChevronRight className="v2-btw-tool-chevron" aria-hidden="true" />
      {icon}
      <span className="v2-btw-tool-counts" title={label}>{label}</span>
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="v2-btw-tool-detail">{children}</CollapsibleContent>
  </Collapsible>;
}

/** Success is a structured tool result, never a claim inferred from answer text. */
export function SideAnalysisResult({ tool }: { readonly tool: SideToolActivity }) {
  const { t } = useI18n();
  return <ToolDisclosure failed={tool.state === 'error'}
    label={t(tool.state === 'done' ? 'Example run completed' : tool.state === 'error' ? 'Example execution failed' : 'Example result unconfirmed')}
    icon={tool.state === 'done' ? <CircleCheck aria-hidden="true" /> : <StatusIcon state={tool.state} />}>
    {tool.code ? <CodeBlock text={tool.code} language={tool.language ?? 'javascript'} /> : null}
    {tool.output ? <pre className="v2-btw-tool-output">{tool.output}</pre> : null}
    {tool.error ? <p className="v2-btw-error">{tool.error}</p> : null}
    <p data-ui-notice="" className="v2-btw-tool-note">{t(tool.state === 'done' ? 'Only this isolated example ran; project tests were not run.' : 'No successful result was confirmed for this example.')}</p>
    {tool.detailsOmitted ? <p data-ui-notice="" className="v2-btw-tool-note">{t('Some earlier or lengthy details were omitted.')}</p> : null}
  </ToolDisclosure>;
}
