import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, GitBranch, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { MessageTimestamp } from './MessageTimestamp';
import { useUiEnvironment } from '../environment';
export function ReplyView({ children, replyText, running = false, completedAt, regenerate, fork, readOnly = false, diagnosticOnly = false, label }: {
  readonly children: ReactNode; readonly replyText?: string; readonly running?: boolean;
  readonly completedAt?: number; readonly regenerate?: () => void; readonly fork?: () => void;
  readonly readOnly?: boolean; readonly diagnosticOnly?: boolean; readonly label?: string;
}) {
  const { copyText, assistantName } = useUiEnvironment();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);
  const showActions = replyText !== undefined && !running && (!diagnosticOnly || replyText.length > 0);
  const showTime = !running && !diagnosticOnly && replyText !== undefined;
  return <div className="v2-assistant-reply flex min-w-0 flex-col gap-1" aria-label={label ?? assistantName}>
    {children}
    {showActions || showTime ? (
      <div data-transcript-selection-exclude="" className="flex min-h-6 select-none items-center gap-0.5 text-[11px] text-muted-foreground [&_button]:size-6 [&_button]:p-0 [&_svg]:size-[13px] [&_.dvx-message-time]:pr-1.5 [&_.dvx-message-time]:text-[10.5px]">
        {showTime ? <MessageTimestamp completedAt={completedAt ?? null} /> : null}
        {showActions ? <>
        <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Copied reply' : 'Copy reply'} disabled={!replyText} onClick={() => {
          void copyText(replyText).then(() => {
            setCopied(true); setCopyError(false);
            if (reset.current) clearTimeout(reset.current);
            reset.current = setTimeout(() => setCopied(false), 1500);
          }, () => setCopyError(true));
        }}>{copied ? <Check /> : <Copy />}</Button>
        {!readOnly && regenerate ? <ReplyAction label="Regenerate response" busyLabel="Regenerating response" action={regenerate}><RotateCcw /></ReplyAction> : null}
        {!readOnly && fork ? <ReplyAction label="Fork chat" busyLabel="Forking chat" action={fork}><GitBranch /></ReplyAction> : null}
        {copyError ? <span role="alert" className="text-destructive">Could not copy reply.</span> : null}
        </> : null}
      </div>
    ) : null}
  </div>;
}
function ReplyAction({ label, busyLabel, action, children }: { readonly label: string; readonly busyLabel: string; readonly action: () => void; readonly children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setBusy(false), 8000);
    return () => clearTimeout(timer);
  }, [busy]);
  return <Button variant="ghost" size="icon-sm" aria-label={busy ? busyLabel : label} title={busy ? busyLabel : label} disabled={busy} aria-busy={busy} onClick={() => { setBusy(true); action(); }}>
    {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : children}
  </Button>;
}
