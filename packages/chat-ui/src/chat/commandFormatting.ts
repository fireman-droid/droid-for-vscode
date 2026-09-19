
/**
 * Deterministic shell-command presentation for the command card
 * (terminal-card redesign, 2026-08-12). One rule-based tokenizer
 * feeds three surfaces: the header's command-name chips, the
 * fallback title, and the syntax-tinted command line. No AI, no
 * invented data — every token is a literal slice of the input, so
 * joining the token texts reproduces the command exactly.
 */

export type CommandTokenKind =
  | 'command'
  | 'flag'
  | 'string'
  | 'variable'
  | 'operator'
  | 'path'
  | 'comment'
  | 'text';

export interface CommandToken {
  readonly kind: CommandTokenKind;
  readonly text: string;
}

/** Longest-first so `&&` wins over `&` and `>>` over `>`. */
const OPERATORS = [
  '2>&1',
  '&&',
  '||',
  '>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '=',
  '(',
  ')',
  '|',
  ';',
  '>',
  '<',
  '&',
] as const;

/** Separators after which the next bare word names a command. */
const COMMAND_SEPARATORS: ReadonlySet<string> = new Set(['&&', '||', '|', ';']);

const WORD_BREAK = '|;&><=\'"#()';

export function tokenizeCommand(command: string): readonly CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;
  let expectCommand = true;
  const push = (kind: CommandTokenKind, text: string): void => {
    if (text.length > 0) {
      tokens.push({ kind, text });
    }
  };
  while (index < command.length) {
    const char = command[index] as string;

    if (/\s/u.test(char)) {
      let end = index;
      while (end < command.length && /\s/u.test(command[end] as string)) {
        end += 1;
      }
      const run = command.slice(index, end);
      if (run.includes('\n')) {
        expectCommand = true;
      }
      push('text', run);
      index = end;
      continue;
    }

    if (char === '#') {
      const lineEnd = command.indexOf('\n', index);
      const end = lineEnd === -1 ? command.length : lineEnd;
      push('comment', command.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < command.length) {
        if (char === '"' && command[end] === '\\') {
          end += 2;
          continue;
        }
        if (command[end] === char) {
          end += 1;
          break;
        }
        end += 1;
      }
      push('string', command.slice(index, Math.min(end, command.length)));
      index = Math.min(end, command.length);
      expectCommand = false;
      continue;
    }

    if (expectCommand) {
      const envAssignmentEnd = scanEnvAssignment(command, index);
      if (envAssignmentEnd !== null) {
        push('variable', command.slice(index, envAssignmentEnd));
        index = envAssignmentEnd;
        continue;
      }
      const powershellVariable = /^\$[A-Za-z_][\w:]*(?=(?:\+|-|\*|\/|%)?=)/u.exec(
        command.slice(index),
      );
      if (powershellVariable !== null) {
        push('variable', powershellVariable[0]);
        index += powershellVariable[0].length;
        continue;
      }
    }

    const operator = OPERATORS.find((candidate) => command.startsWith(candidate, index));
    if (operator !== undefined) {
      push('operator', operator);
      index += operator.length;
      if (COMMAND_SEPARATORS.has(operator)) {
        expectCommand = true;
      }
      continue;
    }

    let end = index;
    while (
      end < command.length &&
      !/\s/u.test(command[end] as string) &&
      !WORD_BREAK.includes(command[end] as string)
    ) {
      end += 1;
    }
    const word = command.slice(index, end);
    index = end;

    // `FOO=bar` prefixes keep the command slot open for the next word.
    if (expectCommand && /^[A-Za-z_][\w-]*=/u.test(word)) {
      push('variable', word);
      continue;
    }
    if (word.startsWith('$')) {
      push('variable', word);
      // In PowerShell `$name = Get-Thing`, the variable is setup
      // syntax rather than the command-card subject. Keep the command
      // slot open through a following assignment operator so the real
      // RHS command becomes the title/chip.
      const remainder = command.slice(index);
      expectCommand = expectCommand && /^[ \t]*(?:\+|-|\*|\/|%)?=/u.test(remainder);
      continue;
    }
    if (word.length > 1 && word.startsWith('-')) {
      push('flag', word);
      expectCommand = false;
      continue;
    }
    if (expectCommand && /^\[[^\]]+\]::/u.test(word)) {
      push('text', word);
      expectCommand = false;
      continue;
    }
    if (expectCommand) {
      push('command', word);
      expectCommand = false;
      continue;
    }
    if (/[\\/]/u.test(word)) {
      push('path', word);
      continue;
    }
    push('text', word);
  }
  return tokens;
}

function scanEnvAssignment(command: string, start: number): number | null {
  const name = /^[A-Za-z_][\w-]*=/u.exec(command.slice(start));
  if (name === null) {
    return null;
  }
  let index = start + name[0].length;
  let quote: '"' | "'" | null = null;
  while (index < command.length) {
    const char = command[index] as string;
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index = Math.min(command.length, index + 2);
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (/\s/u.test(char) || '|;&><'.includes(char)) {
      break;
    }
    index += 1;
  }
  return index;
}

/**
 * Deduplicated command names of a (possibly chained) command line for
 * the header chips — "cd, rg, Select-Object" — capped at four like
 * the reference design.
 */
export function commandChips(command: string): readonly string[] {
  const names: string[] = [];
  for (const token of tokenizeCommand(command)) {
    if (token.kind !== 'command' || names.includes(token.text)) {
      continue;
    }
    names.push(token.text);
    if (names.length >= 4) {
      break;
    }
  }
  return names;
}

const MAX_TITLE_LENGTH = 64;

/** Positioning preambles that make a meaningless title on their own. */
const PREAMBLE_COMMANDS: ReadonlySet<string> = new Set(['cd', 'pushd', 'set-location']);

/**
 * Header title of the command card. A runtime-provided execute
 * `summary` arrives as a non-generic `action` and wins; otherwise the
 * title is rule-generated from the first meaningful command segment
 * (command name plus up to two bare-word arguments: "git status",
 * "pnpm run build"; a leading `cd` preamble is skipped when a real
 * command follows). Never fabricated — worst case it stays the
 * generic action text.
 */
export function commandCardTitle(
  action: string,
  genericAction: string,
  command: string | null,
): string {
  if (action !== genericAction) {
    return action;
  }
  if (command === null) {
    return action;
  }
  const tokens = tokenizeCommand(command);
  let start = tokens.findIndex(
    (token) =>
      token.kind === 'command' && !PREAMBLE_COMMANDS.has(token.text.toLocaleLowerCase()),
  );
  if (start === -1) {
    start = tokens.findIndex((token) => token.kind === 'command');
  }
  if (start === -1) {
    return action;
  }
  const words = [(tokens[start] as CommandToken).text];
  for (
    let position = start + 1;
    position < tokens.length && words.length < 3;
    position += 1
  ) {
    const token = tokens[position] as CommandToken;
    if (token.kind === 'text' && /^[ \t]+$/u.test(token.text)) {
      continue;
    }
    if (token.kind === 'text' && /^[\w.:@-]+$/u.test(token.text)) {
      words.push(token.text);
      continue;
    }
    break;
  }
  const title = words.join(' ');
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : title;
}
