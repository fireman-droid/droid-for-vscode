import type { RootContent } from 'hast';

export interface MarkdownParseRequest {
  readonly id: number;
  readonly text: string;
  readonly thinking: boolean;
  readonly streaming?: boolean;
  readonly reset?: boolean;
}
export type MarkdownParseResponse = {
  readonly id: number;
  readonly nodes: readonly { readonly version: number; readonly node?: RootContent }[];
} | { readonly id: number; readonly error: string };

// Reference equality first (settled cached blocks and O(1) fence projections),
// falling back to exact serialized equality without hash collisions.
export function createMarkdownTreeDelta() {
  let previous: readonly { node: RootContent; serialized?: string; version: number }[] = [];
  let version = 0;
  return (nodes: readonly RootContent[]): Extract<MarkdownParseResponse, { nodes: unknown }>['nodes'] => {
    const next = nodes.map((node, index) => {
      const old = previous[index];
      if (old?.node === node) return { node, serialized: old.serialized, version: old.version };
      const serialized = JSON.stringify(node);
      const oldSerialized = old ? (old.serialized ?? JSON.stringify(old.node)) : undefined;
      return { node, serialized, version: oldSerialized === serialized ? old!.version : ++version };
    });
    const delta = next.map((entry, index) => entry.version === previous[index]?.version
      ? { version: entry.version } : { version: entry.version, node: nodes[index]! });
    previous = next;
    return delta;
  };
}
