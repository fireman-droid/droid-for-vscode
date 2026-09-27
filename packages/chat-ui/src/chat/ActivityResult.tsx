import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { codeLanguageForPath, highlightCode } from '../markdown/highlightCode';
import { useUiEnvironment } from '../environment';
import { Button } from '../ui/button';

export const ActivityResult = memo(function ActivityResult({ preview }: {
  readonly preview: { readonly text: string; readonly label: string; readonly sourcePath?: string; readonly truncated: boolean };
}) {
  const { copyText } = useUiEnvironment();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const language = preview.sourcePath ? codeLanguageForPath(preview.sourcePath) : undefined;
  const html = useMemo(() => language === undefined ? null : highlightCode(preview.text, language), [language, preview.text]);
  return <section aria-label={preview.label} className="v2-activity-result overflow-hidden rounded-md border border-[var(--panel-edge)] bg-muted/25">
    <header className="flex min-h-7 select-none items-center gap-2 border-b border-[var(--panel-edge)] px-2">
      <span className="min-w-0 flex-1 text-[10.5px] font-medium text-muted-foreground">{preview.label}</span>
      {preview.truncated ? <span className="text-[10px] text-muted-foreground">truncated</span> : null}
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copied ? 'Copied result' : 'Copy result'} onClick={() => {
        void copyText(preview.text).then(() => {
          setCopied(true); setCopyError(false);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }, () => setCopyError(true));
      }}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}</Button>
    </header>
    <pre className="markdown-content max-h-64 overflow-auto overscroll-contain whitespace-pre p-2.5 font-mono text-[11px] leading-[18px] [scrollbar-gutter:stable]">
      {html === null ? <code>{preview.text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
    {copyError ? <p role="alert" className="border-t border-[var(--panel-edge)] px-2 py-1 text-[10.5px] text-destructive">Could not copy result.</p> : null}
  </section>;
}, (previous, next) => previous.preview.text === next.preview.text &&
  previous.preview.label === next.preview.label &&
  previous.preview.sourcePath === next.preview.sourcePath &&
  previous.preview.truncated === next.preview.truncated);
