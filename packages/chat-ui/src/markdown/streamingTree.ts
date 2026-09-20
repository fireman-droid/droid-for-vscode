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
  return (tree: TextTree): void => {
    const visit = (node: TextTree, prose: boolean): void => {
      if (SKIP.has(node.tagName ?? '') || node.children === undefined) return;
      const eligible = prose || node.tagName === 'p' || node.tagName === 'li';
      node.children = node.children.map((child) => {
        if (eligible && child.type === 'text' && child.value?.trim()) {
          return {
            type: 'element', tagName: 'span',
            properties: {
              'data-stream-start': child.position?.start.offset ?? -1,
              'data-stream-end': child.position?.end.offset ?? -1,
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
