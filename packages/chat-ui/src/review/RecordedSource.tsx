import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useUiEnvironment } from '../environment';
import { codeLanguageForPath, highlightCode } from '../markdown/highlightCode';
import { Button } from '../ui/button';

export function RecordedSource({ content, path, label = 'Recorded version' }: {
  readonly content: string; readonly path: string; readonly label?: string;
}) {
  const { copyText } = useUiEnvironment();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const language = codeLanguageForPath(path);
  const html = useMemo(() => language && content.length <= 32_000 ? highlightCode(content, language) : null, [content, language]);
  const lines = useMemo(() => {
    const count = content.length === 0 ? 0 : content.split('\n').length;
    return { count, numbers: Array.from({ length: count }, (_, index) => index + 1).join('\n') };
  }, [content]);
  return <section className="review-recorded-source">
    <header className="review-source-toolbar">
      <span>{label}</span><span className="review-source-size">{lines.count === 0 ? 'Empty file' : `${lines.count} lines`}</span>
      <Button variant="ghost" size="icon-sm" aria-label={copyState === 'copied' ? 'Copied recorded file' : 'Copy recorded file'} onClick={() => {
        void copyText(content).then(() => {
          setCopyState('copied');
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopyState('idle'), 1500);
        }, () => setCopyState('error'));
      }}>{copyState === 'copied' ? <Check /> : <Copy />}</Button>
    </header>
    <div className="review-source-scroll markdown-content" role="region" tabIndex={0} aria-label={`${label} of ${path}`}>
      <div className="review-source-lines" aria-hidden>{lines.numbers}</div>
      <pre>{html === null ? <code>{content || ' '}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
    </div>
    {copyState === 'error' ? <p className="review-recorded-note review-error" role="alert">Could not copy the recorded file.</p> : null}
  </section>;
}
