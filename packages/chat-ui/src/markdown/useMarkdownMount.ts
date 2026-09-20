import { useEffect, useState } from 'react';
import type { RootContent } from 'hast';

const NODES_PER_FRAME = 64;

/** Parsing is already whole-document. Yield only between mounting its complete
 * top-level AST nodes so a restored reply does not commit thousands of DOM
 * nodes in a single task; all content is mounted before pending clears. */
export function useMarkdownMount(nodes: readonly RootContent[], background: boolean, source: string) {
  const [state, setState] = useState({ nodes, source, count: background ? Math.min(nodes.length, NODES_PER_FRAME) : nodes.length });
  const current = state.nodes === nodes && state.source === source ? state : {
    nodes, source, count: background ? Math.min(nodes.length, source.startsWith(state.source)
      ? Math.max(state.count, NODES_PER_FRAME) : NODES_PER_FRAME) : nodes.length,
  };
  if (state !== current) setState(current);
  useEffect(() => {
    if (current.count >= nodes.length) return;
    const frame = requestAnimationFrame(() => setState((previous) => ({
      ...previous, count: Math.min(previous.nodes.length, previous.count + NODES_PER_FRAME),
    })));
    return () => cancelAnimationFrame(frame);
  }, [nodes, current.count]);
  return { nodes: current.count < nodes.length ? nodes.slice(0, current.count) : nodes, pending: current.count < nodes.length };
}
