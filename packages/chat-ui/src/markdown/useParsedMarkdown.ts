import { useEffect, useMemo, useRef, useState } from 'react';
import type { RootContent } from 'hast';
import { parseMarkdown } from './parseMarkdown';
import { markdownWorkerSource } from './markdownWorkerSource';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdownWorkerProtocol';
import { createMarkdownParser } from './markdownParserQueue';
import { recallMarkdown, retainMarkdown, type ParsedMarkdown } from './markdownRenderCache';

const BACKGROUND_THRESHOLD = 8_192;
// Streams reparse on every appended batch. Move medium replies off the UI
// thread before their repeated parses consume most of a 16 ms frame.
const STREAM_BACKGROUND_THRESHOLD = 2_048;
const canUseWorker = () => typeof Worker !== 'undefined' && markdownWorkerSource !== undefined;
export function useParsedMarkdown(text: string, thinking: boolean, streaming: boolean) {
  const [background, setBackground] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [parsed, setParsed] = useState(() => recallMarkdown(text, thinking));
  const [error, setError] = useState<Error | null>(null);
  const latest = useRef({ text, thinking, streaming });
  latest.current = { text, thinking, streaming };
  const request = useRef<(() => void) | null>(null);
  const lastVisible = useRef<ParsedMarkdown>(parsed ?? { text: '', thinking, nodes: [] });
  const threshold = streaming ? STREAM_BACKGROUND_THRESHOLD : BACKGROUND_THRESHOLD;
  const offload = !unavailable && (background || text.length >= threshold && canUseWorker());
  if (offload && !background) setBackground(true);
  const synchronous = useMemo(() => {
    if (offload) return null;
    const cached = recallMarkdown(text, thinking);
    // Prefixes are useful while a worker parses a stream, but a synchronous
    // render must use the entire current document, including closing fences.
    if (cached?.text === text) return cached.nodes;
    const nodes = parseMarkdown(text, thinking);
    if (!streaming) retainMarkdown({ text, thinking, nodes });
    return nodes;
  }, [offload, text, thinking, streaming]);

  useEffect(() => {
    if (!background || unavailable) return;
    let worker: ReturnType<typeof createMarkdownParser> | null = null;
    let id = 0;
    let active: MarkdownParseRequest | null = null;
    let completed: { text: string; thinking: boolean } | null = parsed;
    let nodes: readonly { version: number; node: RootContent }[] = [];
    const release = () => {
      worker?.terminate();
      worker = null; nodes = []; active = null;
    };
    const send = () => {
      const value = latest.current;
      if (active && (!value.text.startsWith(active.text) || value.thinking !== active.thinking)) release();
      if (active) return;
      if (completed?.text === value.text && completed.thinking === value.thinking) {
        if (!value.streaming) release();
        return;
      }
      if (!worker) {
        worker = createMarkdownParser(receive, (cause, unavailable) => {
          release();
          if (unavailable) {
            console.warn('Background Markdown parsing is unavailable; using the synchronous renderer.', cause);
            setUnavailable(true);
          } else setError(cause);
        });
      }
      worker.retain(value.streaming);
      active = { id: ++id, text: value.text, thinking: value.thinking };
      worker.postMessage(active);
    };
    const receive = (data: MarkdownParseResponse) => {
      if (!active || data.id !== active.id) return;
      if ('error' in data) { release(); setError(new Error(data.error)); return; }
      const result = active;
      nodes = data.nodes.map((entry, index) => {
        const node = entry.node ?? (nodes[index]?.version === entry.version ? nodes[index]!.node : undefined);
        if (!node) throw new Error('Background Markdown returned an invalid node revision.');
        return { version: entry.version, node };
      });
      completed = result;
      active = null;
      // Replacements (for example a different reply) never flash an obsolete
      // result; append-only streams can show the completed prefix immediately.
      if (latest.current.thinking === result.thinking && latest.current.text.startsWith(result.text)) {
        const rendered = { text: result.text, thinking: result.thinking, nodes: nodes.map((entry) => entry.node) };
        retainMarkdown(rendered);
        setParsed(rendered);
      }
      send();
    };
    request.current = send;
    send();
    return () => { request.current = null; release(); };
  }, [background, unavailable]);
  useEffect(() => { request.current?.(); }, [text, thinking, streaming]);
  if (error) throw error;
  const compatible = (value: ParsedMarkdown) => value.thinking === thinking && text.startsWith(value.text);
  const result = synchronous ? { text, thinking, nodes: synchronous }
    : parsed && compatible(parsed) ? parsed : compatible(lastVisible.current) ? lastVisible.current : { text: '', thinking, nodes: [] };
  const visible = result.nodes;
  lastVisible.current = result;
  return { nodes: visible, background: offload, pending: offload && (parsed?.text !== text || parsed.thinking !== thinking) };
}
