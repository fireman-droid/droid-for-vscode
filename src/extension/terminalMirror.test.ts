import { describe, expect, it } from 'vitest';

import {
  computeTailDelta,
  createTerminalMirror,
  type MirrorPseudoterminal,
  type TerminalMirror,
} from './terminalMirror';

interface FakeTerminal {
  readonly name: string;
  readonly pty: MirrorPseudoterminal;
  readonly writes: string[];
  showCalls: number;
  disposed: boolean;
}

function createHarness(): {
  mirror: TerminalMirror;
  terminals: FakeTerminal[];
  last(): FakeTerminal;
  /** All writes of the newest terminal, ANSI stripped, CRLF folded. */
  plain(): string;
} {
  const terminals: FakeTerminal[] = [];
  const mirror = createTerminalMirror({
    createTerminal: (name, pty) => {
      const terminal: FakeTerminal = {
        name,
        pty,
        writes: [],
        showCalls: 0,
        disposed: false,
      };
      pty.onDidWrite((data) => terminal.writes.push(data));
      terminals.push(terminal);
      return {
        show: () => {
          terminal.showCalls += 1;
        },
        dispose: () => {
          terminal.disposed = true;
        },
      };
    },
    now: () => new Date(2026, 7, 12, 16, 4, 32),
  });
  const last = (): FakeTerminal => {
    const terminal = terminals.at(-1);
    if (terminal === undefined) {
      throw new Error('no terminal created');
    }
    return terminal;
  };
  return {
    mirror,
    terminals,
    last,
    plain: () =>
      last()
        .writes.join('')
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '')
        .replace(/\r\n/gu, '\n'),
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('createTerminalMirror', () => {
  it('creates the terminal lazily once and reuses it on later opens', () => {
    const h = createHarness();
    expect(h.terminals).toHaveLength(0);
    h.mirror.open();
    h.mirror.open();
    expect(h.terminals).toHaveLength(1);
    expect(h.last().name).toBe('DroidVisX: 命令输出');
    expect(h.last().showCalls).toBe(2);
  });

  it('writes the read-only banner when the pty opens', () => {
    const h = createHarness();
    h.mirror.open();
    expect(h.last().writes).toHaveLength(0);
    h.last().pty.open();
    expect(h.plain()).toContain('[DroidVisX 镜像终端 · 只读]');
  });

  it('discards keyboard input and hints exactly once', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.last().pty.handleInput('rm -rf /\r');
    h.last().pty.handleInput('x');
    const text = h.plain();
    expect(text).not.toContain('rm -rf');
    expect(text).not.toContain('x');
    expect(count(text, '[只读镜像 · 输入已忽略]')).toBe(1);
  });

  it('writes a command separator header with time and session tag', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({
      toolUseId: 't1',
      command: 'pnpm ls',
      sessionTag: 'a1b2c3d4',
    });
    expect(h.plain()).toContain('$ pnpm ls · 16:04:32 · a1b2c3d4');
  });

  it('shows only the first line of a multi-line command in the header', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({
      toolUseId: 't1',
      command: 'pnpm run build &&\npnpm test',
    });
    const text = h.plain();
    expect(text).toContain('$ pnpm run build && …');
    expect(text).not.toContain('pnpm test');
  });

  it('defers the header until the command text has parsed', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1' });
    expect(h.plain()).not.toContain('$');
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    expect(count(h.plain(), '$ pnpm ls')).toBe(1);
  });

  it('keeps the first parsed command across repeated tool-starts', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandStarted({
      toolUseId: 't1',
      command: 'pnpm ls --depth=2',
    });
    const text = h.plain();
    expect(count(text, '$ pnpm ls')).toBe(1);
    expect(text).not.toContain('--depth=2');
  });

  it('appends growing tail snapshots without duplicating output', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandOutput('t1', 'one\ntwo');
    h.mirror.commandOutput('t1', 'one\ntwo\nthree');
    const text = h.plain();
    expect(text).toContain('one\ntwo\nthree');
    expect(count(text, 'two')).toBe(1);
  });

  it('stitches saturated windows via overlap instead of re-printing', () => {
    // Realistic saturated tails share a >240-char overlap region.
    const line = (n: number): string =>
      `line-${String(n).padStart(4, '0')}-${'x'.repeat(24)}`;
    const lines = Array.from({ length: 24 }, (_, i) => line(i));
    const previous = lines.slice(0, 20).join('\n');
    const next = lines.slice(2, 24).join('\n');
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'build' });
    h.mirror.commandOutput('t1', previous);
    h.mirror.commandOutput('t1', next);
    const text = h.plain();
    expect(count(text, line(19))).toBe(1);
    expect(text).toContain(`${line(19)}\n${line(20)}`);
    expect(text).toContain(line(23));
    expect(text).not.toContain('[输出间隔未镜像]');
  });

  it('replays a rewritten trailing progress line in place', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'download' });
    h.mirror.commandOutput('t1', 'fetching\nprogress 50%');
    h.mirror.commandOutput('t1', 'fetching\nprogress 80%');
    const raw = h.last().writes.join('');
    expect(raw).toContain('\r\u001b[2K');
    expect(count(h.plain(), 'fetching')).toBe(1);
    expect(h.plain()).toContain('progress 80%');
  });

  it('marks a gap when output outruns the snapshot window', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'flood' });
    h.mirror.commandOutput('t1', 'aaaa\nbbbb');
    h.mirror.commandOutput('t1', 'yyyy\nzzzz');
    const text = h.plain();
    expect(text).toContain('aaaa');
    expect(text).toContain('[输出间隔未镜像]');
    expect(text).toContain('zzzz');
  });

  it('notes silent commands on settle', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'true' });
    h.mirror.commandSettled('t1');
    expect(count(h.plain(), '[无输出流]')).toBe(1);
  });

  it('does not add the silent note to commands that produced output', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandOutput('t1', 'pkg-a');
    h.mirror.commandSettled('t1');
    expect(h.plain()).not.toContain('[无输出流]');
  });

  it('backfills the running command when opened mid-run', () => {
    const h = createHarness();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandOutput('t1', 'one\ntwo');
    h.mirror.open();
    h.last().pty.open();
    expect(h.plain()).toContain('$ pnpm ls');
    expect(h.plain()).toContain('one\ntwo');
    // Later snapshots continue incrementally from the backfill.
    h.mirror.commandOutput('t1', 'one\ntwo\nthree');
    expect(count(h.plain(), 'two')).toBe(1);
    expect(h.plain()).toContain('three');
  });

  it('never replays commands that settled before the terminal opened', () => {
    const h = createHarness();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandOutput('t1', 'pkg-a');
    h.mirror.commandSettled('t1');
    h.mirror.open();
    h.last().pty.open();
    const text = h.plain();
    expect(text).not.toContain('pnpm ls');
    expect(text).not.toContain('pkg-a');
  });

  it('recreates the terminal after a user close, on explicit open only', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'watch' });
    h.mirror.commandOutput('t1', 'tick 1');
    h.last().pty.close();
    // Output keeps flowing while closed; nothing reopens by itself.
    h.mirror.commandOutput('t1', 'tick 1\ntick 2');
    expect(h.terminals).toHaveLength(1);
    h.mirror.open();
    h.last().pty.open();
    expect(h.terminals).toHaveLength(2);
    const text = h.plain();
    expect(text).toContain('$ watch');
    expect(text).toContain('tick 1\ntick 2');
    expect(count(text, 'tick 2')).toBe(1);
  });

  it('separates interleaved writers with a continuation marker', () => {
    const h = createHarness();
    h.mirror.open();
    h.last().pty.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'first' });
    h.mirror.commandStarted({ toolUseId: 't2', command: 'second' });
    h.mirror.commandOutput('t1', 'from-first');
    h.mirror.commandOutput('t2', 'from-second');
    h.mirror.commandOutput('t1', 'from-first\nfirst-again');
    const text = h.plain();
    expect(text).toContain('[续 $ first]');
    expect(text).toContain('first-again');
  });

  it('bounds buffered output while the pty has not opened yet', () => {
    const h = createHarness();
    h.mirror.open();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'flood' });
    // Disjoint snapshots force full rewrites, growing the buffer
    // beyond its bound before the pty ever opens.
    for (let i = 0; i < 20; i += 1) {
      h.mirror.commandOutput('t1', `${String(i)}-${'x'.repeat(7000)}`);
    }
    h.last().pty.open();
    const text = h.plain();
    expect(text).toContain('[早期输出未完整镜像]');
    expect(text.length).toBeLessThan(120_000);
    expect(text).toContain(`19-${'x'.repeat(7000)}`);
  });

  it('settleAll clears tracked commands so reopen backfills nothing', () => {
    const h = createHarness();
    h.mirror.commandStarted({ toolUseId: 't1', command: 'pnpm ls' });
    h.mirror.commandOutput('t1', 'pkg-a');
    h.mirror.settleAll();
    h.mirror.open();
    h.last().pty.open();
    expect(h.plain()).not.toContain('pnpm ls');
    expect(h.plain()).not.toContain('pkg-a');
  });

  it('dispose disposes the terminal and blocks further opens', () => {
    const h = createHarness();
    h.mirror.open();
    h.mirror.dispose();
    expect(h.last().disposed).toBe(true);
    h.mirror.open();
    expect(h.terminals).toHaveLength(1);
  });
});

describe('computeTailDelta', () => {
  it('writes everything when nothing was written before', () => {
    expect(computeTailDelta('', 'abc')).toEqual({
      prefix: 'none',
      text: 'abc',
    });
  });

  it('writes nothing for identical snapshots', () => {
    expect(computeTailDelta('abc', 'abc')).toEqual({
      prefix: 'none',
      text: '',
    });
  });

  it('appends the suffix of a grown snapshot', () => {
    expect(computeTailDelta('abc', 'abcdef')).toEqual({
      prefix: 'none',
      text: 'def',
    });
  });

  it('rewrites the final line when only it changed', () => {
    expect(computeTailDelta('a\n50%', 'a\n80%')).toEqual({
      prefix: 'clear-line',
      text: '80%',
    });
  });

  it('reports a gap for disjoint snapshots', () => {
    expect(computeTailDelta('aaaa', 'zzzz')).toEqual({
      prefix: 'gap',
      text: 'zzzz',
    });
  });
});
