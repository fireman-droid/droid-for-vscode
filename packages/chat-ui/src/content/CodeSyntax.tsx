import { Fragment, memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useUiEnvironment } from '../environment';
import type { CodeHighlightHints } from '../markdown/highlightCode';
import { requestSyntax } from '../syntax/syntaxQueue';

interface Source { readonly text: string; readonly language?: string | null; readonly path?: string }
interface HighlightedSource extends Source {
  readonly lines: readonly string[];
  readonly lineHtml: Readonly<Record<number, string>>;
  readonly error?: string;
}

const CodeLine = memo(function CodeLine({
  html,
  plain,
}: {
  readonly html?: string;
  readonly plain: string;
}) {
  return html !== undefined ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <>{plain}</>;
});

/** Shared worker-backed tokens; surfaces retain their own layout and actions. */
export const CodeSyntax = memo(function CodeSyntax({ text, language, path }: CodeHighlightHints & {
  readonly text: string; readonly streaming?: boolean;
}) {
  const streamKey = useId();
  const { createSyntaxWorker } = useUiEnvironment();
  const cleanText = text.endsWith('\n') ? text.slice(0, -1) : text;
  const target = useMemo<Source>(() => ({ text: cleanText, language, path }), [cleanText, language, path]);
  const latest = useRef<Source>(target);
  latest.current = target;
  const [highlighted, setHighlighted] = useState<HighlightedSource>();
  const [error, setError] = useState<string>();
  const sendRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!createSyntaxWorker) return;
    let cancelActive: (() => void) | null = null;
    let inFlight = false;
    let activeSource: Source | null = null;
    let completed: Source | null = null;

    const send = () => {
      const next = latest.current;
      if (inFlight && activeSource && (!next.text.startsWith(activeSource.text) || next.language !== activeSource.language || next.path !== activeSource.path)) {
        cancelActive?.();
        cancelActive = null;
        inFlight = false;
        activeSource = null;
      }
      if (inFlight) return;
      if (!next.text.trim()) return;
      if (completed && completed.text === next.text && completed.language === next.language && completed.path === next.path) {
        return;
      }
      inFlight = true;
      activeSource = next;
      cancelActive = requestSyntax(
        createSyntaxWorker,
        { documents: [{ text: next.text, streamKey }], language: next.language, path: next.path },
        (result) => {
          inFlight = false;
          activeSource = null;
          cancelActive = null;
          completed = next;
          if (result.error) console.warn('Source highlighting:', result.error);
          setError(result.error);
          const doc = result.documents[0];
          if (doc) {
            setHighlighted({
              text: next.text,
              language: next.language,
              path: next.path,
              lines: next.text.split('\n'),
              lineHtml: doc,
              error: result.error,
            });
          }
          const current = latest.current;
          if (current.text !== next.text || current.language !== next.language || current.path !== next.path) {
            send();
          }
        },
      );
    };

    sendRef.current = send;
    send();
    return () => {
      sendRef.current = null;
      cancelActive?.();
    };
  }, [createSyntaxWorker, streamKey]);

  useEffect(() => {
    sendRef.current?.();
  }, [target]);

  const current = highlighted
    && highlighted.language === language
    && highlighted.path === path
    && text.startsWith(highlighted.text)
    ? highlighted
    : undefined;

  return <code className="bg-transparent text-foreground" title={current?.error ?? error}>{current ? <>
    {current.lines.map((line, index) => (
      <Fragment key={index}>
        {index > 0 ? '\n' : null}
        <CodeLine html={current.lineHtml[index]} plain={line} />
      </Fragment>
    ))}
    {text.slice(current.text.length)}
  </> : text}</code>;
});
