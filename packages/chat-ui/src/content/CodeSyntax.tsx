import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeHighlightHints } from '../markdown/highlightCode';
import { useSyntaxHighlight } from '../syntax/useSyntaxHighlight';

interface Source { readonly text: string; readonly language?: string | null; readonly path?: string }
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Shared worker-backed tokens; surfaces retain their own layout and actions. */
export const CodeSyntax = memo(function CodeSyntax({ text, language, path, streaming = false }: CodeHighlightHints & {
  readonly text: string; readonly streaming?: boolean;
}) {
  const latest = useRef<Source>({ text, language, path });
  latest.current = { text: streaming && text.endsWith('\n') ? text.slice(0, -1) : text, language, path };
  const [sample, setSample] = useState(latest.current);
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setSample(latest.current), 150);
    return () => clearInterval(timer);
  }, [streaming]);
  const source = streaming ? sample : latest.current;
  const request = useMemo(() => ({ documents: [{ text: source.text }], language: source.language, path: source.path }),
    [source.text, source.language, source.path]);
  const result = useSyntaxHighlight(request);
  const parsed = useMemo(() => result?.documents[0] ? { ...source,
    html: source.text.split('\n').map((line, index) => result.documents[0]![index] ?? escape(line)).join('\n'),
  } : undefined, [source.text, source.language, source.path, result]);
  const [previous, setPrevious] = useState<typeof parsed>();
  useEffect(() => { if (parsed) setPrevious(parsed); }, [parsed]);
  const candidate = parsed ?? (streaming ? previous : undefined);
  const current = candidate && candidate.language === language && candidate.path === path && text.startsWith(candidate.text) ? candidate : undefined;
  return <code className="bg-transparent text-foreground" title={result?.error}>{current ? <>
    <span dangerouslySetInnerHTML={{ __html: current.html }} />{text.slice(current.text.length)}
  </> : text}</code>;
});
