import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from '../markdown/highlightCode';
import { isInlineHtmlPreviewCandidate, readCanvasTitle, stableSourceId } from '../markdown/markdownPolicy';
import { Button } from '../ui/button';
import { MarkdownState, useContent } from './context';
import { useUiEnvironment } from '../environment';

const MAX_HIGHLIGHT_CHARACTERS = 32_000;

export function CodeBlock({ text, language }: { readonly text: string; readonly language: string | null }) {
  const { copyText } = useUiEnvironment();
  const { actions, maxPreviewHtmlLength, previewHtmlDescription } = useContent();
  const { streaming, thinking } = useContext(MarkdownState);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  // Keep complete text and copy behavior without building a large token DOM
  // repeatedly while streaming or for oversized code blocks.
  const html = useMemo(() => language === null || streaming || text.length > MAX_HIGHLIGHT_CHARACTERS
    ? null : highlightCode(text, language), [text, language, streaming]);
  const preview = actions?.previewHtml !== undefined && !streaming && !thinking && isInlineHtmlPreviewCandidate(language, text);
  return <div className="v2-code-block my-3 min-w-0 overflow-hidden rounded border border-border">
    {preview ? <div data-transcript-selection-exclude="" className="flex select-none items-center justify-between gap-2 border-b border-border bg-muted px-2 py-1.5">
      <span className="min-w-0 text-xs"><span className="block truncate">{readCanvasTitle(text)}</span><span className="block text-[11px] text-muted-foreground">{previewHtmlDescription ?? 'HTML preview'}</span></span>
      <Button variant="outline" size="sm" disabled={maxPreviewHtmlLength !== undefined && text.length > maxPreviewHtmlLength} onClick={() => actions.previewHtml?.(text, { artifactId: `inline:${stableSourceId(text)}`, title: readCanvasTitle(text) })}>Open Canvas</Button>
    </div> : null}
    <div className="v2-code-body">
    <header data-transcript-selection-exclude="" className="v2-code-toolbar flex select-none items-center justify-between border-b border-border bg-muted px-2 py-1">
      <span className="v2-code-language text-[11px] text-muted-foreground">{language ?? 'text'}</span>
      <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Copied' : 'Copy code'} onClick={() => {
        void copyText(text).then(() => {
          setCopied(true); setCopyError(false);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }, () => setCopyError(true));
      }}>{copied ? <Check /> : <Copy />}</Button>
    </header>
    <pre tabIndex={0} role="region" aria-label={`${language ?? 'Plain text'} code`}
      className="max-h-[480px] max-w-full overflow-auto overscroll-x-contain bg-muted/40 p-2.5 text-xs leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring">
      {html === null ? <code>{text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
    </div>
    {copyError ? <p role="alert" className="px-2 py-1 text-xs text-destructive">Could not copy code.</p> : null}
  </div>;
}
