import { describe, expect, it } from 'vitest';

import {
  commandCardTitle,
  commandChips,
  tokenizeCommand,
} from './commandCard';

describe('tokenizeCommand', () => {
  it('is lossless: joined token texts reproduce the input', () => {
    const command =
      'cd "D:\\repo"; FOO=1 rg -n --no-ignore \'buildDisplayNodes\' src/*.ts | Select-Object -First 12 # tail';
    expect(
      tokenizeCommand(command)
        .map((token) => token.text)
        .join(''),
    ).toBe(command);
  });

  it('marks the first word of every chained segment as a command', () => {
    const kinds = new Map(
      tokenizeCommand('cd src && git status; rg -n foo | head')
        .filter((token) => token.kind === 'command')
        .map((token) => [token.text, token.kind]),
    );
    expect([...kinds.keys()]).toEqual(['cd', 'git', 'rg', 'head']);
  });

  it('classifies flags, strings, variables, operators, and paths', () => {
    const tokens = tokenizeCommand(
      'rg --no-ignore -B2 "needle" $HOME src/webview/App.tsx 2>&1',
    );
    const byKind = (kind: string) =>
      tokens.filter((token) => token.kind === kind).map((t) => t.text);
    expect(byKind('command')).toEqual(['rg']);
    expect(byKind('flag')).toEqual(['--no-ignore', '-B2']);
    expect(byKind('string')).toEqual(['"needle"']);
    expect(byKind('variable')).toEqual(['$HOME']);
    expect(byKind('operator')).toEqual(['2>&1']);
    expect(byKind('path')).toEqual(['src/webview/App.tsx']);
  });

  it('keeps an env assignment before the command name', () => {
    const tokens = tokenizeCommand('TERM=dumb pnpm test');
    expect(tokens.find((token) => token.kind === 'command')?.text).toBe(
      'pnpm',
    );
    expect(tokens[0]).toEqual({ kind: 'variable', text: 'TERM=dumb' });
  });

  it('reopens the command slot after a newline', () => {
    const commands = tokenizeCommand('pnpm build\npnpm test')
      .filter((token) => token.kind === 'command')
      .map((token) => token.text);
    expect(commands).toEqual(['pnpm', 'pnpm']);
  });

  it('survives an unterminated quote without hanging', () => {
    const tokens = tokenizeCommand("echo 'unclosed");
    expect(tokens.map((token) => token.text).join('')).toBe(
      "echo 'unclosed",
    );
  });
});

describe('commandChips', () => {
  it('lists deduplicated command names capped at four', () => {
    expect(
      commandChips(
        "cd 'D:\\x'; Write-Output a; rg -n b | Select-Object -First 5; jq .; sort",
      ),
    ).toEqual(['cd', 'Write-Output', 'rg', 'Select-Object']);
  });

  it('deduplicates repeated commands', () => {
    expect(commandChips('git add -A && git commit && git push')).toEqual([
      'git',
    ]);
  });
});

describe('commandCardTitle', () => {
  it('prefers a runtime-provided execute summary over the rule', () => {
    expect(
      commandCardTitle('Check working tree state', 'Execute', 'git status'),
    ).toBe('Check working tree state');
  });

  it('rule-generates from the first command segment otherwise', () => {
    expect(
      commandCardTitle('Ran a local command', 'Execute', 'git status'),
    ).toBe('git status');
    expect(
      commandCardTitle('Ran a local command', 'Execute', 'pnpm run build'),
    ).toBe('pnpm run build');
    // Flags end the phrase: no flag soup in the title.
    expect(
      commandCardTitle(
        'Ran a local command',
        'Execute',
        'rg -n --no-ignore needle | head',
      ),
    ).toBe('rg');
  });

  it('skips a cd preamble when a real command follows', () => {
    expect(
      commandCardTitle(
        'Ran a local command',
        'Execute',
        "cd 'D:\\repo'; git log --oneline",
      ),
    ).toBe('git log');
    // All-preamble commands keep the preamble as the honest title.
    expect(
      commandCardTitle('Ran a local command', 'Execute', 'cd src/app'),
    ).toBe('cd');
  });

  it('falls back to the generic action when nothing usable exists', () => {
    expect(
      commandCardTitle('Ran a local command', 'Execute', null),
    ).toBe('Ran a local command');
    expect(
      commandCardTitle('Ran a local command', 'Execute', '"only strings"'),
    ).toBe('Ran a local command');
  });

  it('bounds the title length', () => {
    const title = commandCardTitle(
      'Ran a local command',
      'Execute',
      `${'x'.repeat(90)} status`,
    );
    expect(title.length).toBeLessThanOrEqual(64);
    expect(title.endsWith('…')).toBe(true);
  });
});
