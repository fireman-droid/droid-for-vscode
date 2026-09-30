import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { highlightCode, type CodeHighlightHints } from '../markdown/highlightCode';

const STREAM_HIGHLIGHT_INTERVAL_MS = 150;

interface HighlightSource {
  readonly text: string;
  readonly language?: string | null;
  readonly path?: string;
}

/** Shared token rendering; each surface keeps its existing layout and actions. */
export const CodeSyntax = memo(function CodeSyntax({ text, language, path, detect, streaming = false }: CodeHighlightHints & {
  readonly text: string;
  readonly streaming?: boolean;
}) {
  const [highlighted, setHighlighted] = useState<(HighlightSource & { readonly html: string | null }) | null>(null);
  const latest = useRef<HighlightSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!streaming) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      latest.current = null;
      return;
    }
    // Markdown adds a final LF even to an unfinished line. Leave it in the live
    // tail so subsequent characters can extend the highlighted source prefix.
    latest.current = { text: text.endsWith('\n') ? text.slice(0, -1) : text, language, path };
    // Read the latest committed text on a fixed cadence; restarting this timer
    // for every token would postpone highlighting until the stream pauses.
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const source = latest.current;
      if (source) setHighlighted({ ...source, html: highlightCode(source.text, {
        language: source.language, path: source.path, detect: false,
      }) });
    }, STREAM_HIGHLIGHT_INTERVAL_MS);
  }, [text, language, path, streaming]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
  }, []);

  const settled = useMemo(() => streaming ? null : highlightCode(text, { language, path, detect }), [text, language, path, detect, streaming]);
  const current = highlighted !== null && highlighted.language === language && highlighted.path === path && text.startsWith(highlighted.text) ? highlighted : null;
  const html = streaming ? current?.html ?? null : settled;
  // Keep every incoming character visible and React-escaped while coloring the
  // last parsed prefix. Replaced text or language hints cannot reuse old spans.
  // Own both foreground and background instead of inheriting host inline-code colors.
  return <code className="bg-transparent text-foreground">{html === null ? text : <>
    <span dangerouslySetInnerHTML={{ __html: html }} />
    {streaming && current ? text.slice(current.text.length) : null}
  </>}</code>;
});
