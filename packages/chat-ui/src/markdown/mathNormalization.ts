import { escapeCurrencyDollars } from './currencyMath';

export function normalizeMathDelimiters(input: string): string {
  const normalized = input
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, formula: string) => `$$\n${formula.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/gu, (_match, formula: string) => `$${formula.trim()}$`);
  return escapeCurrencyDollars(promoteBareLatexBlocks(promoteDisplayEnvironments(normalized)));
}

const DISPLAY_ENVIRONMENT = /\\(?:begin|end)\{(?:array|aligned|gathered|matrix|pmatrix|bmatrix|cases)\}/u;
const DOUBLE_DOLLAR_MATH = /\$\$([\s\S]*?)\$\$/gu;
const BARE_LATEX_COMMAND = /\\(?:operatorname|begin|boxed|text|qquad|frac|sqrt|binom|le|ge|ne|neq|times|cdot|infty)\b/u;
const BARE_DISPLAY_ENVIRONMENT = /^\s*\\begin\{(?:array|aligned|gathered|matrix|pmatrix|bmatrix|cases)\}/u;
const DISPLAY_ENVIRONMENT_END = /\\end\{(?:array|aligned|gathered|matrix|pmatrix|bmatrix|cases)\}/u;
const CODE_FENCE = /^\s*(`{3,}|~{3,})/u;
const HAN_CHARACTER = /\p{Script=Han}/u;

function promoteDisplayEnvironments(input: string): string {
  return input.replace(DOUBLE_DOLLAR_MATH, (match: string, formula: string) =>
    DISPLAY_ENVIRONMENT.test(formula) ? `$$\n${formula.trim()}\n$$` : match);
}

function promoteBareLatexBlocks(input: string): string {
  const output: string[] = [];
  let inCodeFence = false;
  let inExistingDisplay = false;
  let inDisplayBlock = false;
  let bareBlock: string[] = [];
  const flushBareBlock = (): void => {
    if (bareBlock.length === 0) return;
    output.push('$$', bareBlock.join('\n').trim(), '$$');
    bareBlock = [];
    inDisplayBlock = false;
  };
  for (const line of input.split('\n')) {
    if (CODE_FENCE.test(line)) {
      flushBareBlock();
      output.push(line);
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) { output.push(line); continue; }
    if (inExistingDisplay) {
      output.push(line);
      if (line.trim() === '$$') inExistingDisplay = false;
      continue;
    }
    if (line.trim() === '$$') {
      flushBareBlock();
      output.push('$$');
      inExistingDisplay = true;
      continue;
    }
    if (inDisplayBlock) {
      bareBlock.push(line);
      if (DISPLAY_ENVIRONMENT_END.test(line)) flushBareBlock();
      continue;
    }
    if (line.includes('$')) { output.push(line); continue; }
    if (!isBareLatexLine(line)) { output.push(line); continue; }
    if (BARE_DISPLAY_ENVIRONMENT.test(line) && !DISPLAY_ENVIRONMENT_END.test(line)) {
      inDisplayBlock = true;
      bareBlock.push(line);
      continue;
    }
    output.push('$$', line.trim(), '$$');
  }
  flushBareBlock();
  return output.join('\n');
}

function isBareLatexLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('\\')) return BARE_LATEX_COMMAND.test(trimmed);
  return !HAN_CHARACTER.test(line) && BARE_LATEX_COMMAND.test(line);
}
