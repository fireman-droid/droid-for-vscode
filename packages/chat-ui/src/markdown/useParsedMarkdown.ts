import { useEffect, useMemo, useRef, useState } from 'react';
import type { RootContent } from 'hast';
import { parseMarkdown } from './parseMarkdown';
import { markdownWorkerSource } from './markdownWorkerSource';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdownWorkerProtocol';
import { createMarkdownParser } from './markdownParserQueue';

const BACKGROUND_THRESHOLD = 8_192;
const canUseWorker = () => typeof Worker !== 'undefined' && markdownWorkerSource !== undefined;
type Parsed = { text: string; thinking: boolean; nodes: readonly RootContent[] };

export function useParsedMarkdown(text: string, thinking: boolean, streaming: boolean) {
  const [background, setBackground] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const latest = useRef({ text, thinking, streaming });
  latest.current = { text, thinking, streaming };
  const request = useRef<(() => void) | null>(null);
  const lastVisible = useRef<Parsed>({ text: '', thinking, nodes: [] });
  const offload = !unavailable && (background || text.length >= BACKGROUND_THRESHOLD && canUseWorker());
  if (offload && !background) setBackground(true);
  const synchronous = useMemo(() => offload ? null : parseMarkdown(text, thinking), [offload, text, thinking]);

  useEffect(() => {
    if (!background || unavailable) return;
    let worker: ReturnType<typeof createMarkdownParser> | null = null;
    let id = 0;
    let active: MarkdownParseRequest | null = null;
    let completed: { text: string; thinking: boolean } | null = null;
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
        setParsed({ text: result.text, thinking: result.thinking, nodes: nodes.map((entry) => entry.node) });
      }
      send();
    };
    request.current = send;
    send();
    return () => { request.current = null; release(); };
  }, [background, unavailable]);
  useEffect(() => { request.current?.(); }, [text, thinking, streaming]);
  if (error) throw error;
  const compatible = (value: Parsed) => value.thinking === thinking && text.startsWith(value.text);
  const result = synchronous ? { text, thinking, nodes: synchronous }
    : parsed && compatible(parsed) ? parsed : compatible(lastVisible.current) ? lastVisible.current : { text: '', thinking, nodes: [] };
  const visible = result.nodes;
  lastVisible.current = result;
  return { nodes: visible, background: offload, pending: offload && (parsed?.text !== text || parsed.thinking !== thinking) };
}
