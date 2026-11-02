import type { Element, RootContent } from 'hast';

export interface OpenFenceState {
  readonly marker: '`' | '~';
  readonly length: number;
  readonly language: string | null;
  readonly blockOffset: number;
  readonly contentOffset: number;
}

export interface MarkdownBlock {
  readonly raw: string;
  readonly offset: number;
  readonly mode: 'full' | 'live';
}

export interface StreamParseState {
  readonly text: string;
  readonly thinking: boolean;
  readonly streaming: boolean;
  readonly hasRefs: boolean;
  readonly openFence: OpenFenceState | null;
  readonly nodes: readonly RootContent[];
}

const REFERENCE_DEFINITION = /^ {0,3}\[[^\r\n\]]+\]:[ \t\r\n]*\S/mu;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u;
const ANY_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/mu;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/u;
const INDENTED_CONTINUATION = /^(?: {2,}|\t)/u;
const INDENTED_CODE = /^(?: {4,}|\t)/u;
const LINE_BLOCK_PREFIX = /^(?: {0,3}>[ \t]?)*(?: {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+| {0,3}#{1,6}[ \t]+)?/u;
const LATEX_BEGIN = /\\begin\{(?:array|aligned|gathered|matrix|pmatrix|bmatrix|cases)\}/gu;
const LATEX_END = /\\end\{(?:array|aligned|gathered|matrix|pmatrix|bmatrix|cases)\}/gu;

export function hasReferenceDefinitions(text: string): boolean {
  return text.includes(']:') && REFERENCE_DEFINITION.test(text);
}

function matchOpeningFence(line: string): { marker: '`' | '~'; length: number; language: string | null } | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const fence = match[1]!;
  const marker = fence[0] as '`' | '~';
  const info = match[2]!;
  if (marker === '`' && info.includes('`')) return null;
  const language = /^[\t ]*([\w#+-]+)/u.exec(info)?.[1] ?? null;
  return { marker, length: fence.length, language };
}

function isClosingFence(line: string, marker: '`' | '~', minLength: number): boolean {
  const trimmed = line.replace(/\r$/u, '');
  let spaces = 0;
  while (spaces < 3 && trimmed[spaces] === ' ') spaces++;
  let count = 0;
  while (trimmed[spaces + count] === marker) count++;
  if (count < minLength) return false;
  for (let i = spaces + count; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

function countDoubleDollars(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '$' && line[i + 1] === '$') { count++; i++; }
  }
  return count;
}

export function splitMarkdownBlocks(text: string): {
  readonly blocks: readonly MarkdownBlock[];
  readonly openFence: OpenFenceState | null;
} {
  if (!text) return { blocks: [], openFence: null };
  const blocks: MarkdownBlock[] = [];
  let blockStart = 0;
  let sawBlankLine = false;
  let blockHasContent = false;
  let blockIsList = false;
  let blockIsIndentedCode = false;
  let openFence: (OpenFenceState & { readonly standalone: boolean }) | null = null;
  let inDollarMath = false;
  let inBracketMath = false;
  let latexEnvDepth = 0;

  let cursor = 0;
  while (cursor < text.length) {
    const newlineIndex = text.indexOf('\n', cursor);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex + 1;
    const rawLine = text.slice(cursor, newlineIndex === -1 ? text.length : newlineIndex).replace(/\r$/u, '');
    const isBlank = rawLine.trim().length === 0;

    if (openFence !== null) {
      if (isClosingFence(rawLine, openFence.marker, openFence.length)) openFence = null;
      cursor = lineEnd;
      continue;
    }

    if (isBlank) {
      if (blockHasContent) sawBlankLine = true;
      cursor = lineEnd;
      continue;
    }

    if (sawBlankLine && !inDollarMath && !inBracketMath && latexEnvDepth === 0) {
      const keepInList = blockIsList && (INDENTED_CONTINUATION.test(rawLine) || LIST_ITEM.test(rawLine));
      const keepInIndentedCode = blockIsIndentedCode && INDENTED_CODE.test(rawLine);
      if (!keepInList && !keepInIndentedCode) {
        blocks.push({ raw: text.slice(blockStart, cursor), offset: blockStart, mode: 'full' });
        blockStart = cursor;
        blockHasContent = false;
        blockIsList = false;
        blockIsIndentedCode = false;
      }
      sawBlankLine = false;
    }

    const isFirstLineOfBlock = !blockHasContent;
    if (isFirstLineOfBlock) {
      blockHasContent = true;
      blockIsList = LIST_ITEM.test(rawLine);
      blockIsIndentedCode = !blockIsList && INDENTED_CODE.test(rawLine);
    } else if (LIST_ITEM.test(rawLine)) {
      blockIsList = true;
    }

    if (!blockIsIndentedCode && !inDollarMath && !inBracketMath && latexEnvDepth === 0) {
      const fence = matchOpeningFence(rawLine);
      if (fence && newlineIndex !== -1) {
        openFence = {
          ...fence,
          blockOffset: blockStart,
          contentOffset: lineEnd,
          standalone: isFirstLineOfBlock,
        };
        cursor = lineEnd;
        continue;
      }
    }

    if (countDoubleDollars(rawLine) % 2 === 1) inDollarMath = !inDollarMath;
    if (rawLine.includes('\\[') && !rawLine.includes('\\]')) inBracketMath = true;
    else if (inBracketMath && rawLine.includes('\\]')) inBracketMath = false;
    const begins = rawLine.match(LATEX_BEGIN)?.length ?? 0;
    const ends = rawLine.match(LATEX_END)?.length ?? 0;
    latexEnvDepth = Math.max(0, latexEnvDepth + begins - ends);

    cursor = lineEnd;
  }

  if (blockStart < text.length) {
    blocks.push({ raw: text.slice(blockStart), offset: blockStart, mode: 'live' });
  }

  return {
    blocks,
    openFence: openFence?.standalone ? {
      marker: openFence.marker,
      length: openFence.length,
      language: openFence.language,
      blockOffset: openFence.blockOffset,
      contentOffset: openFence.contentOffset,
    } : null,
  };
}

function updateCodePreElement(node: RootContent, nextCodeText: string, language: string | null): Element {
  const codeProperties = language ? { className: [`language-${language}`] } : {};
  const existingPre = node.type === 'element' && node.tagName === 'pre' ? node : null;
  const existingCode = existingPre?.children[0]?.type === 'element' && existingPre.children[0].tagName === 'code'
    ? existingPre.children[0]
    : null;
  return {
    type: 'element',
    tagName: 'pre',
    properties: existingPre?.properties ?? {},
    children: [{
      type: 'element',
      tagName: 'code',
      properties: existingCode?.properties ?? codeProperties,
      children: nextCodeText.length > 0 ? [{ type: 'text', value: nextCodeText }] : [],
    }],
  };
}

export function projectUnclosedCodeFence(
  previous: StreamParseState,
  text: string,
  thinking: boolean,
  streaming: boolean,
): StreamParseState | null {
  const fence = previous.openFence;
  if (!fence || previous.thinking !== thinking || previous.hasRefs || !text.startsWith(previous.text)) return null;
  if (text === previous.text && previous.streaming === streaming) return previous;
  if (hasReferenceDefinitions(text.slice(previous.text.length))) return null;

  const prevLastNewline = previous.text.lastIndexOf('\n', Math.max(0, previous.text.length - 1));
  const checkStart = Math.max(fence.contentOffset, prevLastNewline + 1);
  let cursor = checkStart;
  while (cursor < text.length) {
    const nl = text.indexOf('\n', cursor);
    const line = text.slice(cursor, nl === -1 ? text.length : nl);
    if (isClosingFence(line, fence.marker, fence.length)) return null;
    if (nl === -1) break;
    cursor = nl + 1;
  }

  const rawBody = text.slice(fence.contentOffset).replace(/\r\n?/gu, '\n');
  const codeValue = rawBody.length === 0 ? '' : rawBody.endsWith('\n') ? rawBody : `${rawBody}\n`;
  const lastNode = previous.nodes.at(-1);
  if (!lastNode || lastNode.type !== 'element' || lastNode.tagName !== 'pre') return null;

  const updatedPre = updateCodePreElement(lastNode, codeValue, fence.language);
  const nextNodes = previous.nodes.length === 1
    ? [updatedPre]
    : [...previous.nodes.slice(0, -1), updatedPre];

  return {
    text,
    thinking,
    streaming,
    hasRefs: false,
    openFence: fence,
    nodes: nextNodes,
  };
}

function isBalancedLatexFragment(fragment: string): boolean {
  const trimmed = fragment.trim();
  if (!trimmed || trimmed.endsWith('\\')) return false;
  if (/\\(?:frac|sqrt|text|textbf|mathrm|operatorname|boxed|begin|end|left|right)$/u.test(trimmed)) return false;
  let braces = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\') { i++; continue; }
    if (trimmed[i] === '{') braces++;
    else if (trimmed[i] === '}') {
      braces--;
      if (braces < 0) return false;
    }
  }
  return braces === 0;
}

/**
 * Completes unclosed inline Markdown tokens on the trailing line of a live block
 * while streaming so raw syntax markers (**bold, *italic, ~~strike, `code, [text](url, $math)
 * do not flash before their closing delimiter arrives.
 */
export function completeStreamingInlineMarkdown(blockText: string): string {
  if (!blockText || ANY_FENCE_LINE.test(blockText)) return blockText;
  const lastLineBreak = blockText.lastIndexOf('\n');
  const rawLastLine = blockText.slice(lastLineBreak + 1);
  if (!rawLastLine || rawLastLine.endsWith('\r') || INDENTED_CODE.test(rawLastLine)) return blockText;
  if (/^\s*\|/u.test(rawLastLine)) return blockText;

  const prefixMatch = LINE_BLOCK_PREFIX.exec(rawLastLine);
  const prefixLen = prefixMatch?.[0].length ?? 0;
  const inlineLine = rawLastLine.slice(prefixLen);
  if (!inlineLine) return blockText;

  let i = 0;
  const len = inlineLine.length;
  let openLinkParen = false;
  let inBracketLabel = 0;
  const emphasisStack: ('**' | '~~' | '*')[] = [];
  let openMath: { delimiter: '$' | '$$'; contentStart: number } | null = null;

  while (i < len) {
    const ch = inlineLine[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '`' && !openMath) {
      let ticks = 1;
      while (i + ticks < len && inlineLine[i + ticks] === '`') ticks++;
      const fence = '`'.repeat(ticks);
      const closeIdx = inlineLine.indexOf(fence, i + ticks);
      if (closeIdx !== -1 && (inlineLine[closeIdx + ticks] !== '`' || ticks > 2)) {
        i = closeIdx + ticks;
        continue;
      }
      const rest = inlineLine.slice(i + ticks);
      if (rest.length > 0) {
        return `${blockText}${fence}`;
      }
      return blockText;
    }

    if (ch === '$') {
      const isDouble = inlineLine[i + 1] === '$';
      const delimiter = isDouble ? '$$' : '$';
      const step = isDouble ? 2 : 1;
      if (openMath) {
        if (openMath.delimiter === delimiter) openMath = null;
        i += step;
        continue;
      }
      if (isDouble) {
        openMath = { delimiter: '$$', contentStart: i + 2 };
        i += 2;
        continue;
      }
      const after = inlineLine.slice(i + 1);
      const isCurrency = /^\d+(?:[.,]\d+)*(?:\b|\s|$)/u.test(after);
      const prevChar = i > 0 ? inlineLine[i - 1]! : '';
      if (!isCurrency && after.length > 0 && !/^\s/u.test(after) && !/\d/u.test(prevChar)) {
        openMath = { delimiter: '$', contentStart: i + 1 };
      }
      i += 1;
      continue;
    }

    if (openMath) {
      i++;
      continue;
    }

    if (ch === '[') {
      inBracketLabel++;
      i++;
      continue;
    }
    if (ch === ']' && inBracketLabel > 0) {
      inBracketLabel--;
      if (inBracketLabel === 0 && inlineLine[i + 1] === '(') {
        openLinkParen = true;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (openLinkParen) {
      if (ch === ')' || ch === ' ' || ch === '\t') openLinkParen = false;
      i++;
      continue;
    }

    if (ch === '*' && inlineLine[i + 1] === '*') {
      const top = emphasisStack.at(-1);
      if (top === '**') {
        emphasisStack.pop();
      } else if (i + 2 < len && !/\s/u.test(inlineLine[i + 2]!)) {
        emphasisStack.push('**');
      }
      i += 2;
      continue;
    }

    if (ch === '~' && inlineLine[i + 1] === '~') {
      const top = emphasisStack.at(-1);
      if (top === '~~') {
        emphasisStack.pop();
      } else if (i + 2 < len && !/\s/u.test(inlineLine[i + 2]!)) {
        emphasisStack.push('~~');
      }
      i += 2;
      continue;
    }

    if (ch === '*') {
      const prev = i > 0 ? inlineLine[i - 1]! : ' ';
      const next = i + 1 < len ? inlineLine[i + 1]! : '';
      const top = emphasisStack.at(-1);
      if (top === '*' && !/\s/u.test(prev)) {
        emphasisStack.pop();
      } else if (next && !/[\s*]/u.test(next) && /[\s([\{"'“‘—–-]/u.test(prev)) {
        emphasisStack.push('*');
      }
      i++;
      continue;
    }

    i++;
  }

  if (openMath) {
    const fragment = inlineLine.slice(openMath.contentStart);
    if (isBalancedLatexFragment(fragment)) {
      return `${blockText}${openMath.delimiter}`;
    }
    return blockText;
  }

  let suffix = '';
  if (openLinkParen) {
    suffix += ')';
  }
  if (emphasisStack.length > 0 && !/[\s*~]$/u.test(inlineLine)) {
    for (let j = emphasisStack.length - 1; j >= 0; j--) {
      suffix += emphasisStack[j]!;
    }
  }
  return suffix ? `${blockText}${suffix}` : blockText;
}
