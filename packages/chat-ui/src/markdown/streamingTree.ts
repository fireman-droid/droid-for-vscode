import type { Element } from 'hast';

interface TextTree {
  type: string;
  tagName?: string;
  value?: string;
  children?: TextTree[];
  properties?: Record<string, unknown>;
  position?: Element['position'];
}
const SKIP = new Set(['pre', 'code', 'table', 'svg', 'math', 'span']);

export function rehypeStreamingText() {
  return (tree: TextTree, file?: { readonly data?: Record<string, unknown> }): void => {
    const baseOffset = typeof file?.data?.baseOffset === 'number' ? file.data.baseOffset : 0;
    const visit = (node: TextTree, prose: boolean): void => {
      if (SKIP.has(node.tagName ?? '') || node.children === undefined) return;
      const eligible = prose || node.tagName === 'p' || node.tagName === 'li';
      node.children = node.children.map((child) => {
        if (eligible && child.type === 'text' && child.value?.trim()) {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          return {
            type: 'element', tagName: 'span',
            properties: {
              'data-stream-start': start !== undefined ? start + baseOffset : -1,
              'data-stream-end': end !== undefined ? end + baseOffset : -1,
            },
            children: [child],
          };
        }
        visit(child, eligible);
        return child;
      });
    };
    visit(tree, false);
  };
}
