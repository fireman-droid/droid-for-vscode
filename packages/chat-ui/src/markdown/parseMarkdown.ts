import type { Root, RootContent } from 'hast';
import { urlAttributes } from 'html-url-attributes';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { VFile } from 'vfile';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { markdownUrlTransform, safeMarkdownUrlTransform } from './markdownPolicy';
import { rehypeStreamingText } from './streamingTree';
import { normalizeMathDelimiters } from './mathNormalization';

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

const UNPARSED_STRONG = /\*\*(?=\S)([\s\S]*?\S)\*\*/gu;

function promoteUnparsedStrong(tree: MdastNode): void {
  if (!tree.children || tree.type === 'code' || tree.type === 'inlineCode' || tree.type === 'math' || tree.type === 'inlineMath') return;
  const next: MdastNode[] = [];
  for (const child of tree.children) {
    if (child.type === 'text' && child.value?.includes('**')) {
      let cursor = 0;
      for (const match of child.value.matchAll(UNPARSED_STRONG)) {
        const index = match.index ?? 0;
        if (index > cursor) next.push({ type: 'text', value: child.value.slice(cursor, index) });
        next.push({ type: 'strong', children: [{ type: 'text', value: match[1]! }] });
        cursor = index + match[0].length;
      }
      if (cursor === 0) next.push(child);
      else if (cursor < child.value.length) next.push({ type: 'text', value: child.value.slice(cursor) });
      continue;
    }
    promoteUnparsedStrong(child);
    next.push(child);
  }
  tree.children = next;
}

// The same pipeline as react-markdown, including its raw-HTML removal and URL
// attribute transform. Parsing remains whole-document: definitions, loose lists
// and incomplete blocks can change nodes anywhere earlier in the reply.
const processor = unified().use(remarkParse).use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: true })
  .use(() => promoteUnparsedStrong)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeKatex).use(rehypeStreamingText);

export function parseMarkdown(text: string, thinking: boolean): readonly RootContent[] {
  const file = new VFile(normalizeMathDelimiters(text));
  const tree = processor.runSync(processor.parse(file), file) as Root;
  visit(tree, (node, index, parent) => {
    if (node.type === 'raw' && parent && index !== undefined) {
      parent.children.splice(index, 1);
      return index;
    }
    if (node.type !== 'element') return;
    for (const key of Object.keys(node.properties)) {
      const tags = Object.hasOwn(urlAttributes, key) ? urlAttributes[key] : undefined;
      if (tags === null || tags?.includes(node.tagName)) {
        const value = String(node.properties[key] || '');
        node.properties[key] = thinking ? safeMarkdownUrlTransform(value) : markdownUrlTransform(value, key);
      }
    }
  });
  return tree.children;
}
