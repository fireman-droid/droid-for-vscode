import { Check, ChevronRight, CircleAlert, CircleCheck, CircleDashed, FileCode2, Globe, Search, GitBranch, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { DroidActivity } from '../ui/droid-motion';
import { CodeBlock } from '../content/CodeBlock';
import type { SideToolActivity } from './sideChat';

const LABELS = {
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

function ToolDisclosure({ label, icon, children, failed = false }: { readonly label: string; readonly icon: ReactNode; readonly children: ReactNode; readonly failed?: boolean }) {
  return <Collapsible className="v2-btw-tool-record" defaultOpen={failed}>
    <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-btw-tool-toggle" data-failed={failed || undefined}>
      {icon}<span>{label}</span><ChevronRight className="v2-btw-tool-chevron" aria-hidden="true" />
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="v2-btw-tool-detail">{children}</CollapsibleContent>
  </Collapsible>;
}

/** One compact activity line. The retained list is expanded only on request. */
export function SideToolRecords({ tools, progress }: { readonly tools: readonly SideToolActivity[]; readonly progress?: { label: string; loading: boolean } }) {
  const { t } = useI18n();
  if (!tools.length) return null;
  const active = [...tools].reverse().find(tool => tool.state === 'running');
  const failed = tools.some(tool => tool.state === 'error');
  const completed = tools.filter(tool => tool.state === 'done');
  const readTargets = new Set(completed.filter(tool => tool.kind === 'read' && tool.target).map(tool => tool.target));
  const label = active ? `${t(LABELS[active.kind][0])}${active.target ? ` · ${active.target}` : ''}` : progress ? progress.label
    : failed ? t('Tool activity includes failures')
    : completed.length < tools.length ? t('Tool activity · some results unconfirmed')
    : readTargets.size && completed.every(tool => tool.kind === 'read') ? t('Read {count} files', { count: readTargets.size })
    : t('Completed {count} tool calls', { count: completed.length });
  return <ToolDisclosure label={label} icon={progress && !active ? <DroidActivity phase={progress.loading ? 'loading' : 'working'} /> : <StatusIcon state={active ? 'running' : failed ? 'error' : completed.length < tools.length ? 'incomplete' : 'done'} />}>
    <ul className="v2-btw-tool-list">{tools.map(tool => {
      const Icon = ICONS[tool.kind];
      const label = t(LABELS[tool.kind][tool.state === 'running' ? 0 : 1]);
      return <li key={tool.id}>
        <div data-ui-notice="" className="v2-btw-tool-row"><Icon aria-hidden="true" /><span>{tool.target ?? (tool.kind === 'other' ? tool.name : label)}</span><span aria-label={t(tool.state === 'done' ? 'Completed' : tool.state === 'error' ? 'Failed' : tool.state === 'running' ? 'Running' : 'Result unconfirmed')}><StatusIcon state={tool.state} /></span></div>
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
