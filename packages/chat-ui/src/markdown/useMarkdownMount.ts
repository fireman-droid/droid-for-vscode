import { useEffect, useLayoutEffect, useState } from 'react';
import type { RootContent } from 'hast';
import { mountedMarkdownCounts } from './markdownRenderCache';

const NODES_PER_FRAME = 64;

/** Parsing is already whole-document. Yield only between mounting its complete
 * top-level AST nodes so a restored reply does not commit thousands of DOM
 * nodes in a single task; all content is mounted before pending clears. */
export function useMarkdownMount(nodes: readonly RootContent[], background: boolean, source: string) {
  const restoredCount = Math.max(NODES_PER_FRAME, mountedMarkdownCounts.get(nodes) ?? 0);
  const [state, setState] = useState({ nodes, source, count: background ? Math.min(nodes.length, restoredCount) : nodes.length });
  const current = state.nodes === nodes && state.source === source ? state : {
    nodes, source, count: background ? Math.min(nodes.length, source.startsWith(state.source)
      ? Math.max(state.count, restoredCount) : restoredCount) : nodes.length,
  };
  if (state !== current) setState(current);
  // Remember committed content, not a render that React may abandon. Returning
  // to a measured row must not replace its lower paragraphs with empty space.
  useLayoutEffect(() => {
    mountedMarkdownCounts.set(nodes, Math.max(current.count, mountedMarkdownCounts.get(nodes) ?? 0));
  }, [nodes, current.count]);
  useEffect(() => {
    if (current.count >= nodes.length) return;
    const frame = requestAnimationFrame(() => setState((previous) => ({
      ...previous, count: Math.min(previous.nodes.length, previous.count + NODES_PER_FRAME),
    })));
    return () => cancelAnimationFrame(frame);
  }, [nodes, current.count]);
  return { nodes: current.count < nodes.length ? nodes.slice(0, current.count) : nodes, pending: current.count < nodes.length };
}
