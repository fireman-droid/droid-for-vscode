import { buildCompletionContext } from '../completionText';
import type { ContextSnippet } from './CompletionContextService';
import type { LanguageComments } from './LanguageComments';

type PromptInput = {
  text: string;
  offset: number;
  maxCharacters: number;
  filepath: string;
  model: string;
  snippets: readonly ContextSnippet[];
  comments?: LanguageComments;
};

/** Codestral's documented multi-file prefix; other models get ordinary reference text. */
export function buildCompletionPrompt(input: PromptInput): { prefix: string; suffix: string } {
  const budget = Math.max(0, Math.trunc(input.maxCharacters));
  const plain = () => buildCompletionContext(input.text, input.offset, budget);
  if (input.snippets.length === 0) return plain();

  const codestral = /codestral/i.test(input.model);
  const lineComment = input.comments?.line;
  const blockComment = input.comments?.block;
  const useComments = Boolean(lineComment || (blockComment && blockComment[1].length >= 2));
  const currentHeader = codestral ? `+++++ ${relativePath(input.filepath)}\n`
    : useComments ? '' : `--- Current file: ${relativePath(input.filepath)} ---\n`;
  // Headers are part of the reference budget. A long current file always retains at least 60%.
  const mainReserve = Math.min(input.text.length, Math.ceil(budget * 0.6));
  let remaining = budget - mainReserve - currentHeader.length;
  const references: string[] = [];

  for (const snippet of input.snippets) {
    if (remaining <= 0) break;
    const path = relativePath(snippet.filepath);
    const render = (content: string): string => {
      if (codestral) return `+++++ ${path}\n${content}\n\n`;
      if (lineComment) {
        const commented = content.replace(/\r?\n/g, (newline) => `${newline}${lineComment} `);
        return `${lineComment} Reference file: ${path}\n${lineComment} ${commented}\n\n`;
      }
      if (blockComment && blockComment[1].length >= 2) {
        const [start, end] = blockComment;
        const escaped = `Reference file: ${path}\n${content}`
          .split(end).join(`${end.slice(0, -1)} ${end.slice(-1)}`);
        return `${start} ${escaped}\n${end}\n\n`;
      }
      return `--- Reference file: ${path} ---\n${content}\n--- End reference file ---\n\n`;
    };
    const reference = fitReference(snippet.content, remaining, render);
    if (reference) {
      references.push(reference);
      remaining -= reference.length;
    }
  }

  if (references.length === 0) return plain();
  const extra = references.join('') + currentHeader;
  const context = buildCompletionContext(input.text, input.offset, budget - extra.length);
  return { prefix: extra + context.prefix, suffix: context.suffix };
}

function fitReference(content: string, budget: number, render: (text: string) => string): string {
  if (!content.trim() || render('').length >= budget) return '';
  let low = 0;
  let high = Math.min(content.length, budget);
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (render(content.slice(0, candidate)).length <= budget) low = candidate;
    else high = candidate - 1;
  }
  const before = content.charCodeAt(low - 1);
  const after = content.charCodeAt(low);
  if ((before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
    || (before === 13 && after === 10)) low -= 1;
  const clipped = content.slice(0, low);
  return clipped.trim() ? render(clipped) : '';
}

function relativePath(value: string): string {
  const clean = value.replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '').replace(/\\/g, '/');
  const parts = clean.split('/').filter((part) => part && part !== '.');
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(clean) || parts.includes('..')) {
    return parts.at(-1) || 'file';
  }
  return parts.join('/') || 'file';
}
