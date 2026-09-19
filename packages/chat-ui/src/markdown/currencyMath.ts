// Currency preprocessing adapted from @assistant-ui/react-markdown/src/preprocess.ts.
// Source: https://github.com/assistant-ui/assistant-ui
// Copyright (c) 2025 AgentbaseAI Inc. MIT License, see THIRD_PARTY_LICENSES.txt.
// Only the standalone currency transform is retained; no runtime library dependency.

const LATEX_SYNTAX = /\\[a-zA-Z]|[_^{}]/;
const BLANK_LINE = /\n[ \t]*\n/;
const ADJACENT_WORDS = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/;
const TRAILING_OPERATOR = /[-+*/=<>,;:([\u2013\u2014\u2212]$/;

function runLength(text: string, start: number, char: string): number {
  let length = 0;
  while (text[start + length] === char) length++;
  return length;
}

function codeSpanEnd(text: string, start: number): number {
  const fence = '`'.repeat(runLength(text, start, '`'));
  const closed = text.indexOf(fence, start + fence.length);
  return closed === -1 ? -1 : closed + fence.length;
}

function findClosingDollar(text: string, openIndex: number): number {
  let index = openIndex + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '$') return index;
    if (char === '\\') index += 2;
    else if (char === '`') {
      const end = codeSpanEnd(text, index);
      index = end === -1 ? index + runLength(text, index, '`') : end;
    } else index += 1;
  }
  return -1;
}

function isMathBody(body: string): boolean {
  if (body.length === 0 || BLANK_LINE.test(body)) return false;
  if ((/\s$/.test(body) && !/^\s/.test(body)) || TRAILING_OPERATOR.test(body)) return false;
  if (LATEX_SYNTAX.test(body)) return true;
  return !ADJACENT_WORDS.test(body);
}

function opensCurrencyAmount(text: string, index: number): boolean {
  return /\d/.test(text[index + 1] ?? '');
}

function endOfVerbatimRun(text: string, index: number): number {
  const char = text[index];
  if (char === '\\') return Math.min(index + 2, text.length);
  if (char === '`') {
    const end = codeSpanEnd(text, index);
    return end === -1 ? index + runLength(text, index, '`') : end;
  }
  if (char !== '$') return index + 1;
  const dollars = runLength(text, index, '$');
  if (dollars >= 2) return index + dollars;
  const close = findClosingDollar(text, index);
  const opensMath = close !== -1 && !opensCurrencyAmount(text, close) && isMathBody(text.slice(index + 1, close));
  return opensMath ? close + 1 : index;
}

/** Preserve code/math delimiters while escaping currency amounts in prose. */
export function escapeCurrencyDollars(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const verbatimEnd = endOfVerbatimRun(text, index);
    if (verbatimEnd > index) {
      out += text.slice(index, verbatimEnd);
      index = verbatimEnd;
      continue;
    }
    out += opensCurrencyAmount(text, index) ? '\\$' : '$';
    index += 1;
  }
  return out;
}
