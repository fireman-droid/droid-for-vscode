import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useSmoothFollowScroll } from '../navigation/useSmoothFollowScroll';
import { ScrollArea } from '../ui/scroll-area';

const CHUNK_SIZE = 4_096;
const STREAM_INTERVAL_MS = 100;

interface TextChunk { readonly text: string }
interface ChunkedText { readonly text: string; readonly chunks: readonly TextChunk[] }

/** Only the final text node changes while thinking grows. The original text,
 * including Markdown and whitespace, remains intact without reparsing it. */
function appendChunks(previous: ChunkedText, text: string): ChunkedText {
  const chunks = text.startsWith(previous.text) ? previous.chunks.slice(0, -1) : [];
  let offset = chunks.reduce((length, chunk) => length + chunk.text.length, 0);
  while (offset < text.length) {
    let end = Math.min(text.length, offset + CHUNK_SIZE);
    // Do not split a UTF-16 pair across DOM text nodes.
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end -= 1;
    chunks.push({ text: text.slice(offset, end) });
    offset = end;
  }
  return { text, chunks };
}

const TextChunkView = memo(function TextChunkView({ chunk }: { readonly chunk: TextChunk }) {
  return <span>{chunk.text}</span>;
});

export const ThinkingBody = memo(function ThinkingBody({ text, running, truncated }: {
  readonly text: string;
  readonly running: boolean;
  readonly truncated: boolean;
}) {
  const { t } = useI18n();
  const latest = useRef(text);
  latest.current = text;
  const [sample, setSample] = useState(text);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSample(latest.current), STREAM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running]);
  // Finishing or replacing a stream must show its complete current value now.
  const displayed = running && text.startsWith(sample) ? sample : text;
  const previous = useRef<ChunkedText>({ text: '', chunks: [] });
  const chunks = useMemo(() => {
    previous.current = appendChunks(previous.current, displayed);
    return previous.current.chunks;
  }, [displayed]);
  const { viewportRef, contentRef, followNewest } = useSmoothFollowScroll<HTMLDivElement>();
  useEffect(() => followNewest(), [displayed, followNewest]);

  return <ScrollArea className="v2-thinking-detail select-none text-muted-foreground [&_*]:select-none"
    viewportRef={viewportRef} viewportClassName="max-h-64" aria-label={t('Thinking')}>
    <div ref={contentRef} className="whitespace-pre-wrap break-words text-[13px] leading-[1.5]">
      {displayed ? chunks.map((chunk, index) => <TextChunkView key={index} chunk={chunk} />)
        : <p role="status">{running ? t('Waiting for thinking text…') : t('No thinking text returned.')}</p>}
      {truncated ? <p role="note" className="mt-2 text-[11px]">{t('Thinking reached the local safety limit; later reasoning is not retained.')}</p> : null}
    </div>
  </ScrollArea>;
});
