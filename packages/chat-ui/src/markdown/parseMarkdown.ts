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
import {
  completeStreamingInlineMarkdown,
  hasReferenceDefinitions,
  projectUnclosedCodeFence,
  splitMarkdownBlocks,
  type StreamParseState,
} from './markdownStream';
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

const MAX_BLOCK_CACHE = 512;
const MAX_STREAM_STATES = 8;
const blockCache = new Map<string, readonly RootContent[]>();
const streamStates: StreamParseState[] = [];

function parseSingleBlock(text: string, thinking: boolean, baseOffset = 0): readonly RootContent[] {
  const file = new VFile(normalizeMathDelimiters(text));
  file.data.baseOffset = baseOffset;
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

function getCachedBlock(raw: string, thinking: boolean, offset: number): readonly RootContent[] {
  const key = `${thinking ? 1 : 0}:${offset}:${raw}`;
  const cached = blockCache.get(key);
  if (cached) {
    blockCache.delete(key);
    blockCache.set(key, cached);
    return cached;
  }
  const parsed = parseSingleBlock(raw, thinking, offset);
  blockCache.set(key, parsed);
  if (blockCache.size > MAX_BLOCK_CACHE) {
    const oldest = blockCache.keys().next().value;
    if (oldest !== undefined) blockCache.delete(oldest);
  }
  return parsed;
}

function findPrefixState(text: string, thinking: boolean): StreamParseState | null {
  let best: StreamParseState | null = null;
  for (const entry of streamStates) {
    if (entry.thinking === thinking && text.startsWith(entry.text) && (!best || entry.text.length > best.text.length)) {
      best = entry;
    }
  }
  return best;
}

function saveStreamState(next: StreamParseState): readonly RootContent[] {
  for (let i = streamStates.length - 1; i >= 0; i--) {
    const entry = streamStates[i]!;
    if (entry.thinking === next.thinking && (next.text.startsWith(entry.text) || entry.text.startsWith(next.text))) {
      streamStates.splice(i, 1);
    }
  }
  streamStates.push(next);
  if (streamStates.length > MAX_STREAM_STATES) streamStates.shift();
  return next.nodes;
}

export function parseMarkdown(text: string, thinking: boolean, streaming = false): readonly RootContent[] {
  if (!text) return [];
  const previous = findPrefixState(text, thinking);
  if (previous && previous.text === text && previous.streaming === streaming) {
    return previous.nodes;
  }
  if (previous?.openFence) {
    const projected = projectUnclosedCodeFence(previous, text, thinking, streaming);
    if (projected) return saveStreamState(projected);
  }
  if (hasReferenceDefinitions(text)) {
    const source = streaming ? completeStreamingInlineMarkdown(text) : text;
    const nodes = parseSingleBlock(source, thinking, 0);
    return saveStreamState({ text, thinking, streaming, hasRefs: true, openFence: null, nodes });
  }
  const { blocks, openFence } = splitMarkdownBlocks(text);
  const nodes: RootContent[] = [];
  for (const block of blocks) {
    if (block.mode === 'full') {
      nodes.push(...getCachedBlock(block.raw, thinking, block.offset));
    } else {
      const source = streaming && openFence === null ? completeStreamingInlineMarkdown(block.raw) : block.raw;
      nodes.push(...parseSingleBlock(source, thinking, block.offset));
    }
  }
  return saveStreamState({ text, thinking, streaming, hasRefs: false, openFence, nodes });
}
