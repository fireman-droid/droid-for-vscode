import type { RootContent } from 'hast';

export interface MarkdownParseRequest {
  readonly id: number;
  readonly text: string;
  readonly thinking: boolean;
  readonly reset?: boolean;
}
export type MarkdownParseResponse = {
  readonly id: number;
  readonly nodes: readonly { readonly version: number; readonly node?: RootContent }[];
} | { readonly id: number; readonly error: string };

// Exact equality, without hash collisions. Unchanged nodes need neither cloning
// back to the main thread nor conversion/reconciliation into React elements.
export function createMarkdownTreeDelta() {
  let previous: readonly { serialized: string; version: number }[] = [];
  let version = 0;
  return (nodes: readonly RootContent[]): Extract<MarkdownParseResponse, { nodes: unknown }>['nodes'] => {
    const next = nodes.map((node, index) => {
      const serialized = JSON.stringify(node);
      const old = previous[index];
      return { serialized, version: old?.serialized === serialized ? old.version : ++version };
    });
    const delta = next.map((entry, index) => entry.version === previous[index]?.version
      ? { version: entry.version } : { version: entry.version, node: nodes[index]! });
    previous = next;
    return delta;
  };
}
