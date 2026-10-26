import { Check, ChevronRight, CircleAlert, CircleCheck, CircleDashed, FileCode2, Globe, Search, GitBranch, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { DroidActivity } from '../ui/droid-motion';
import { CodeBlock } from '../content/CodeBlock';
import type { SideToolActivity } from './sideChat';

export const SIDE_TOOL_LABELS = {
  read: ['Reading code…', 'Read code'], search: ['Searching…', 'Search'],
  web: ['Looking up documentation…', 'Look up documentation'], git: ['Querying Git…', 'Git query'],
  analysis: ['Running example…', 'Run example'], other: ['Using tools…', 'Tool'],
} as const;
const ICONS = { read: FileCode2, search: Search, web: Globe, git: GitBranch, analysis: Wrench, other: Wrench };

function StatusIcon({ state }: { readonly state: SideToolActivity['state'] }) {
  if (state === 'running') return <DroidActivity phase="working" />;
  const Icon = state === 'done' ? Check : state === 'error' ? CircleAlert : CircleDashed;
  return <Icon aria-hidden="true" />;
}

function summarizeSideTools(tools: readonly SideToolActivity[], t: ReturnType<typeof useI18n>['t']): string {
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

function ToolDisclosure({ label, status, icon, children, failed = false }: {
  readonly label: ReactNode;
  readonly status?: string | null;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly failed?: boolean;
}) {
  return <Collapsible className="v2-btw-tool-record" defaultOpen={failed}>
    <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-btw-tool-toggle" data-failed={failed || undefined}>
      <ChevronRight className="v2-btw-tool-chevron" aria-hidden="true" />
      {icon}
      {typeof label === 'string' ? <span className="v2-btw-tool-counts" title={label}>{label}</span> : label}
      {status ? <span className="v2-btw-tool-status" data-failed={failed || undefined}>{status}</span> : null}
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="v2-btw-tool-detail">{children}</CollapsibleContent>
  </Collapsible>;
}

/** One compact activity line. The retained list is expanded only on request. */
export function SideToolRecords({ tools }: { readonly tools: readonly SideToolActivity[] }) {
  const { t } = useI18n();
  if (!tools.length) return null;
  const active = [...tools].reverse().find(tool => tool.state === 'running');
  const failedCount = tools.filter(tool => tool.state === 'error').length;
  const completed = tools.filter(tool => tool.state === 'done');
  const summary = summarizeSideTools(tools, t);
  const status = failedCount > 0 ? t('{count} failed', { count: failedCount })
    : !active && completed.length < tools.length ? t('Result unconfirmed') : null;
  return <ToolDisclosure failed={failedCount > 0} status={status}
    label={<><span className="v2-btw-tool-verb">{t('Explored')}</span><span className="v2-btw-tool-counts" title={summary}>{summary}</span></>}>
    <ul className="v2-btw-tool-list">{tools.map(tool => {
      const Icon = ICONS[tool.kind];
      const fallback = t(SIDE_TOOL_LABELS[tool.kind][tool.state === 'running' ? 0 : 1]);
      const text = tool.target ?? (tool.kind === 'other' ? tool.name : fallback);
      return <li key={tool.id}>
        <div data-ui-notice="" className="v2-btw-tool-row">
          <Icon aria-hidden="true" />
          <span title={text}>{text}</span>
          {tool.state !== 'done' ? <span aria-label={t(tool.state === 'error' ? 'Failed' : tool.state === 'running' ? 'Running' : 'Result unconfirmed')} data-failed={tool.state === 'error' || undefined}><StatusIcon state={tool.state} /></span> : null}
        </div>
        {tool.error ? <p className="v2-btw-error">{tool.error}</p> : null}
        {tool.output ? <pre className="v2-btw-tool-output">{tool.output}</pre> : null}
        {tool.detailsOmitted ? <p data-ui-notice="" className="v2-btw-tool-note">{t('Some earlier or lengthy details were omitted.')}</p> : null}
      </li>;
    })}</ul>
  </ToolDisclosure>;
}

/** Success is a structured tool result, never a claim inferred from answer text. */
export function SideAnalysisResults({ tools }: { readonly tools: readonly SideToolActivity[] }) {
  const { t } = useI18n();
  return tools.map(tool => <ToolDisclosure key={tool.id} failed={tool.state === 'error'}
    label={t(tool.state === 'done' ? 'Example run completed' : tool.state === 'error' ? 'Example execution failed' : 'Example result unconfirmed')}
    icon={tool.state === 'done' ? <CircleCheck aria-hidden="true" /> : <StatusIcon state={tool.state} />}>
    {tool.code ? <CodeBlock text={tool.code} language={tool.language ?? 'javascript'} /> : null}
    {tool.output ? <pre className="v2-btw-tool-output">{tool.output}</pre> : null}
    {tool.error ? <p className="v2-btw-error">{tool.error}</p> : null}
    <p data-ui-notice="" className="v2-btw-tool-note">{t(tool.state === 'done' ? 'Only this isolated example ran; project tests were not run.' : 'No successful result was confirmed for this example.')}</p>
    {tool.detailsOmitted ? <p data-ui-notice="" className="v2-btw-tool-note">{t('Some earlier or lengthy details were omitted.')}</p> : null}
  </ToolDisclosure>);
}
