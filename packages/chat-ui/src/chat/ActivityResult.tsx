import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from '../markdown/highlightCode';
import { useUiEnvironment } from '../environment';
import { Button } from '../ui/button';

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  cjs: 'javascript', css: 'css', html: 'html', java: 'java', js: 'javascript',
  json: 'json', jsx: 'javascript', md: 'markdown', mjs: 'javascript', py: 'python',
  rs: 'rust', sh: 'shell', ts: 'typescript', tsx: 'typescript', vue: 'html',
  xml: 'xml', yaml: 'yaml', yml: 'yaml',
};

function languageFor(path: string): string | null {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase();
  return extension ? EXTENSION_LANGUAGES[extension] ?? null : null;
}

export function ActivityResult({ preview }: {
  readonly preview: { readonly text: string; readonly label: string; readonly sourcePath?: string; readonly truncated: boolean };
}) {
  const { copyText } = useUiEnvironment();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const language = preview.sourcePath ? languageFor(preview.sourcePath) : null;
  const html = useMemo(() => language === null ? null : highlightCode(preview.text, language), [language, preview.text]);
  return <section aria-label={preview.label} className="v2-activity-result overflow-hidden rounded-md border border-border/80 bg-muted/25">
    <header className="flex min-h-7 select-none items-center gap-2 border-b border-border/70 px-2">
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
    <pre className="markdown-content max-h-64 overflow-auto whitespace-pre p-2.5 font-mono text-[11px] leading-[18px] [scrollbar-gutter:stable]">
      {html === null ? <code>{preview.text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
    {copyError ? <p role="alert" className="border-t border-border/70 px-2 py-1 text-[10.5px] text-destructive">Could not copy result.</p> : null}
  </section>;
}
