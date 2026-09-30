import { useEffect, useMemo } from 'react';
import { renderMermaid } from '../content/mermaidRenderer';
import { useSessionViewer } from './useSessionViewer';
import { ContentProvider } from '../content/context';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { ReadOnlyTranscript } from './ReadOnlyTranscript';

export function SessionViewerApp({ vscode }: { readonly vscode: { postMessage(message: unknown): void } }) {
  const { snapshot, theme, canStop, stop } = useSessionViewer(vscode);
  useEffect(() => applyTheme(theme.preference, theme.resolved), [theme.preference, theme.resolved]);
  const content = useMemo(() => ({ workspaceRoot: null, theme: theme.resolved, renderDiagram: renderMermaid }), [theme.resolved]);
  return <ContentProvider value={content}><main className="v2-session-viewer v2-chat-surface grid h-full min-w-0 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
    <header className="border-b border-border/80">
      <div className="v2-chat-rail flex min-h-10 items-center justify-between gap-3 py-2">
        <h1 title={snapshot?.target.title} className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{snapshot?.target.title ?? 'Session activity'}</h1>
        <p role="status" className={`shrink-0 text-[11px] ${snapshot?.lifecycle === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{snapshot === null ? 'Loading' : snapshot.stopping ? 'Stopping…' : snapshot.lifecycle.charAt(0).toUpperCase() + snapshot.lifecycle.slice(1)}</p>
        {canStop ? <Button size="sm" variant="ghost" className="shrink-0 hover:bg-destructive/5 hover:text-destructive active:bg-destructive/10" disabled={snapshot?.stopping === true} onClick={stop}>Stop</Button> : null}
      </div>
    </header>
    <div>
      {snapshot?.stopError ? <p role="alert" className="v2-chat-rail py-2 text-xs text-destructive">Stop failed. The session may still be working.</p> : null}
    </div>
    {snapshot === null || snapshot.status === 'unavailable' ? <section aria-label="Read-only session transcript" className="v2-chat-rail overflow-auto py-6">
      {snapshot === null ? <DroidLoading label="Loading session…" detail="Reading the saved conversation." />
        : <p className="grid min-h-[180px] place-items-center text-center text-[11px] text-muted-foreground">{snapshot.reason}</p>}</section>
      : <ReadOnlyTranscript key={snapshot.target.mode === 'standard' ? snapshot.target.sessionId : snapshot.target.mode} items={snapshot.items} running={snapshot.running} truncated={snapshot.truncated} />}
  </main></ContentProvider>;
}
