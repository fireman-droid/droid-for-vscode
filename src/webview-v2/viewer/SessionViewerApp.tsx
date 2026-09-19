import { useEffect, useMemo } from 'react';
import { renderMermaid } from '../../webview/assistant/markdown/mermaidRenderer';
import { useSessionViewer } from '../../webview/sessionViewer/useSessionViewer';
import { ContentProvider } from '../content/context';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { ReadOnlyTranscript } from './ReadOnlyTranscript';

export function SessionViewerApp({ vscode }: { readonly vscode: { postMessage(message: unknown): void } }) {
  const { snapshot, theme, canStop, stop } = useSessionViewer(vscode);
  useEffect(() => applyTheme(theme.preference, theme.resolved), [theme.preference, theme.resolved]);
  const content = useMemo(() => ({ workspaceRoot: null, theme: theme.resolved, renderDiagram: renderMermaid }), [theme.resolved]);
  return <ContentProvider value={content}><main className="grid h-full min-w-0 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)]">
    <header className="flex min-h-[46px] items-center justify-between gap-4 border-b border-border/80 px-[max(12px,calc((100%-760px)/2))] py-2">
      <div className="flex min-w-0 items-baseline gap-[9px]"><h1 className="truncate text-[12.5px] font-semibold leading-[19px]">{snapshot?.target.title ?? 'Session activity'}</h1>
        <p role="status" className="shrink-0 text-[10.5px] text-muted-foreground">{snapshot === null ? 'Loading' : snapshot.stopping ? 'Stopping…' : snapshot.lifecycle.charAt(0).toUpperCase() + snapshot.lifecycle.slice(1)}</p>
      </div>
      {canStop ? <Button size="sm" variant="link" className="h-auto shrink-0 px-px py-0.5 text-[11px] text-muted-foreground hover:text-destructive" disabled={snapshot?.stopping === true} onClick={stop}>Stop</Button> : null}
    </header>
    <div>
      {snapshot?.stopError ? <p role="alert" className="px-3 py-2 text-xs text-destructive">Stop failed. The session may still be working.</p> : null}
    </div>
    {snapshot === null || snapshot.status === 'unavailable' ? <section aria-label="Read-only session transcript" className="overflow-auto px-3 py-6">
      {snapshot === null ? <DroidLoading label="Loading session…" detail="Reading the saved conversation." />
        : <p className="grid min-h-[180px] place-items-center text-center text-[11px] text-muted-foreground">{snapshot.reason}</p>}</section>
      : <ReadOnlyTranscript key={snapshot.target.mode === 'standard' ? snapshot.target.sessionId : snapshot.target.mode} items={snapshot.items} running={snapshot.running} truncated={snapshot.truncated} />}
  </main></ContentProvider>;
}
