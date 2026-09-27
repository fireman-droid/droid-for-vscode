/**
 * Read-only VS Code terminal mirror of Droid's execute-tool output
 * (native-terminal design §4.2, slice A). One lazily created
 * pseudoterminal named `Droid: 命令输出` aggregates every execute
 * command of the active session; keyboard input is discarded
 * (takeover is fail-closed by design).
 *
 * Data source: the tier1 §1 output channel. Each `tool-progress`
 * runtime event carries a sanitized, bounded *tail snapshot* of the
 * command's cumulative output (`outputTail`, ANSI already stripped
 * upstream by `toToolOutputTail`), not an incremental chunk. The
 * mirror stitches consecutive snapshots back into an append stream:
 * overlap between the previously written tail and the next snapshot
 * is detected and only the new suffix is written; a rewritten
 * trailing line (carriage-return progress bars) is replayed as an
 * in-place line update; when output outruns the snapshot window a
 * quiet gap marker is written instead of fabricating continuity.
 *
 * Credential red line: mirrored text goes only to the terminal.
 * Nothing here is ever recorded to diagnostics logs (same rule as
 * the transcript output preview).
 */

const MIRROR_TERMINAL_NAME = 'Droid: 命令输出';

/** Dim-gray decoration for mirror-authored lines (UI restraint). */
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

const READ_ONLY_BANNER = `${DIM}[Droid 镜像终端 · 只读]${RESET}\r\n`;
const INPUT_DISCARDED_HINT = `\r\n${DIM}[只读镜像 · 输入已忽略]${RESET}\r\n`;
const NO_OUTPUT_NOTE = `${DIM}[无输出流]${RESET}\r\n`;
const GAP_NOTE = `${DIM}[输出间隔未镜像]${RESET}\r\n`;
const PENDING_DROPPED_NOTE = `${DIM}[早期输出未完整镜像]${RESET}\r\n`;

/** Carriage return + erase-line: replays a rewritten progress line. */
const CLEAR_LINE = '\r\u001b[2K';

/** Longest command excerpt shown in a separator header. */
const MAX_HEADER_COMMAND_LENGTH = 160;

/**
 * Bound on text buffered between `createTerminal` and the
 * pseudoterminal's `open()` callback (backpressure: oldest chunks are
 * dropped and a gap note is flushed first).
 */
const MAX_PENDING_CHARS = 100_000;

/** Probe window used to locate snapshot overlap (see below). */
const OVERLAP_PROBE_LENGTH = 240;

/**
 * Candidate probe positions verified before giving up. Natural
 * output matches on the first; only degenerate repeated-character
 * floods produce more, and those degrade to a gap marker instead of
 * an O(n²) scan on every progress event.
 */
const MAX_OVERLAP_CANDIDATES = 8;

interface MirrorDisposable {
  dispose(): void;
}

/** Structural subset of `vscode.Pseudoterminal` the mirror implements. */
export interface MirrorPseudoterminal {
  readonly onDidWrite: (listener: (data: string) => void) => MirrorDisposable;
  open(): void;
  close(): void;
  handleInput(data: string): void;
}

/** Structural subset of `vscode.Terminal` the mirror drives. */
export interface MirrorTerminalHandle {
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/**
 * VS Code adapter seam: production passes
 * `(name, pty) => vscode.window.createTerminal({ name, pty })`,
 * tests pass a fake capturing the pty.
 */
export interface TerminalMirrorDeps {
  createTerminal(name: string, pty: MirrorPseudoterminal): MirrorTerminalHandle;
  /** Clock for separator headers; defaults to `Date`. */
  now?: () => Date;
}

export interface MirrorCommandStart {
  readonly toolUseId: string;
  /** Shell command from the tool input, when it parsed. */
  readonly command?: string;
  /** Short active-session marker for the separator header. */
  readonly sessionTag?: string;
}

export interface TerminalMirror {
  /** Reveal the mirror terminal, creating it lazily on first use. */
  open(): void;
  commandStarted(start: MirrorCommandStart): void;
  /** Latest sanitized tail snapshot of one command's output. */
  commandOutput(toolUseId: string, outputTail: string): void;
  commandSettled(toolUseId: string): void;
  /** Turn over: no more output can arrive for tracked commands. */
  settleAll(): void;
  dispose(): void;
}

interface TrackedCommand {
  readonly command?: string;
  readonly sessionTag?: string;
  /** Latest tail snapshot; backfills a terminal opened mid-run. */
  lastTail: string | null;
}

interface TerminalInstance {
  /** Placeholder until `createTerminal` returns; real right after. */
  handle: MirrorTerminalHandle;
  ptyOpened: boolean;
  pending: string[];
  pendingChars: number;
  pendingDropped: boolean;
  inputHintShown: boolean;
  /** Tool calls whose separator header this instance has written. */
  readonly headerWritten: Set<string>;
  /** Exactly what this instance has written per command so far. */
  readonly writtenTail: Map<string, string>;
  /** Command that wrote last, to detect interleaved writers. */
  lastWriter: string | null;
  readonly listeners: Set<(data: string) => void>;
}

/**
 * Incremental writes needed to advance a terminal that already shows
 * `previous` so that it shows `next`, where both are trailing
 * snapshots of the same growing output. Exported for focused tests.
 */
export function computeTailDelta(
  previous: string,
  next: string,
): { readonly prefix: 'none' | 'clear-line' | 'gap'; readonly text: string } {
  if (previous.length === 0) {
    return { prefix: 'none', text: next };
  }
  if (next === previous) {
    return { prefix: 'none', text: '' };
  }
  const appended = suffixToAppend(previous, next);
  if (appended !== undefined) {
    return { prefix: 'none', text: appended };
  }
  // The snapshot's final line may have been rewritten in place
  // (carriage-return progress bars survive sanitizing as a changed
  // last line). Match against the body above that line and replay
  // the rewrite as an erase + rewrite.
  const lastBreak = previous.lastIndexOf('\n');
  if (lastBreak !== -1) {
    const body = previous.slice(0, lastBreak + 1);
    const rewritten = suffixToAppend(body, next);
    if (rewritten !== undefined) {
      return { prefix: 'clear-line', text: rewritten };
    }
  }
  return { prefix: 'gap', text: next };
}

/**
 * The suffix of `next` left to write when `next` continues what
 * `previous` already shows; undefined when no overlap exists. Both
 * strings are suffixes of the same cumulative output, so the overlap
 * is some suffix of `previous` appearing as a prefix of `next`. A
 * short probe (the last `OVERLAP_PROBE_LENGTH` chars of `previous`)
 * locates candidates in `next`; each candidate is verified in full
 * before being trusted.
 */
function suffixToAppend(previous: string, next: string): string | undefined {
  if (previous.length === 0) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  const probe = previous.slice(-OVERLAP_PROBE_LENGTH);
  let index = next.indexOf(probe);
  for (
    let candidates = 0;
    index !== -1 && candidates < MAX_OVERLAP_CANDIDATES;
    candidates += 1
  ) {
    const overlap = index + probe.length;
    if (overlap <= previous.length && previous.endsWith(next.slice(0, overlap))) {
      return next.slice(overlap);
    }
    index = next.indexOf(probe, index + 1);
  }
  return undefined;
}

export function createTerminalMirror(deps: TerminalMirrorDeps): TerminalMirror {
  const now = deps.now ?? (() => new Date());
  /** Running commands in start order (Map preserves insertion). */
  const commands = new Map<string, TrackedCommand>();
  let instance: TerminalInstance | null = null;
  let disposed = false;

  function write(text: string): void {
    const current = instance;
    if (current === null || text.length === 0) {
      return;
    }
    if (!current.ptyOpened) {
      current.pending.push(text);
      current.pendingChars += text.length;
      while (current.pendingChars > MAX_PENDING_CHARS && current.pending.length > 1) {
        const dropped = current.pending.shift();
        current.pendingChars -= dropped?.length ?? 0;
        current.pendingDropped = true;
      }
      return;
    }
    for (const listener of current.listeners) {
      listener(text);
    }
  }

  /** Command output uses LF; the pty needs CRLF. */
  function writeOutput(text: string): void {
    write(text.replace(/\n/gu, '\r\n'));
  }

  function writeHeader(toolUseId: string, entry: TrackedCommand): void {
    const current = instance;
    if (current === null || current.headerWritten.has(toolUseId)) {
      return;
    }
    current.headerWritten.add(toolUseId);
    const time = formatHeaderTime(now());
    const tag =
      entry.sessionTag === undefined || entry.sessionTag.length === 0
        ? ''
        : ` · ${entry.sessionTag}`;
    const command =
      entry.command === undefined
        ? `${DIM}(命令未捕获)${RESET}`
        : headerCommandExcerpt(entry.command);
    write(`\r\n$ ${command}${DIM} · ${time}${tag}${RESET}\r\n`);
    current.lastWriter = toolUseId;
  }

  function appendSnapshot(toolUseId: string, entry: TrackedCommand, tail: string): void {
    const current = instance;
    if (current === null) {
      return;
    }
    writeHeader(toolUseId, entry);
    if (current.lastWriter !== toolUseId) {
      // Another command wrote in between (parallel tool calls):
      // re-orient the reader before appending this one's output.
      const command =
        entry.command === undefined ? '' : ` $ ${headerCommandExcerpt(entry.command)}`;
      write(`\r\n${DIM}[续${command}]${RESET}\r\n`);
      current.lastWriter = toolUseId;
    }
    const written = current.writtenTail.get(toolUseId) ?? '';
    const delta = computeTailDelta(written, tail);
    if (delta.prefix === 'clear-line') {
      write(CLEAR_LINE);
    } else if (delta.prefix === 'gap') {
      write(`\r\n${GAP_NOTE}`);
    }
    writeOutput(delta.text);
    current.writtenTail.set(toolUseId, tail);
  }

  function forget(toolUseId: string): void {
    commands.delete(toolUseId);
    instance?.headerWritten.delete(toolUseId);
    instance?.writtenTail.delete(toolUseId);
  }

  function settleOne(toolUseId: string, entry: TrackedCommand): void {
    const current = instance;
    if (current !== null && current.headerWritten.has(toolUseId)) {
      // Tails are trimmed upstream, so the cursor rests mid-line:
      // end this command's block on a fresh line. A command whose
      // header was the last thing written gets the no-output note.
      if (entry.lastTail === null) {
        write(
          current.lastWriter === toolUseId ? NO_OUTPUT_NOTE : `\r\n${NO_OUTPUT_NOTE}`,
        );
      } else if (current.lastWriter === toolUseId) {
        write('\r\n');
      }
    }
    forget(toolUseId);
  }

  function createInstance(): TerminalInstance {
    const listeners = new Set<(data: string) => void>();
    const created: TerminalInstance = {
      // Inert placeholder; replaced with the real terminal handle
      // before `createInstance` returns.
      handle: {
        show: () => undefined,
        dispose: () => undefined,
      },
      ptyOpened: false,
      pending: [],
      pendingChars: 0,
      pendingDropped: false,
      inputHintShown: false,
      headerWritten: new Set(),
      writtenTail: new Map(),
      lastWriter: null,
      listeners,
    };
    const pty: MirrorPseudoterminal = {
      onDidWrite: (listener) => {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
      open: () => {
        if (instance !== created) {
          return;
        }
        created.ptyOpened = true;
        const pending = created.pending;
        created.pending = [];
        created.pendingChars = 0;
        const flush = created.pendingDropped
          ? [PENDING_DROPPED_NOTE, ...pending]
          : pending;
        created.pendingDropped = false;
        for (const chunk of flush) {
          for (const listener of listeners) {
            listener(chunk);
          }
        }
      },
      close: () => {
        // User closed the terminal: fall back to the lazy state and
        // never auto-reopen. Tracked commands survive so the next
        // explicit open backfills whatever is still running.
        if (instance === created) {
          instance = null;
        }
      },
      handleInput: () => {
        // Takeover is fail-closed: every keystroke is discarded.
        if (instance !== created || created.inputHintShown) {
          return;
        }
        created.inputHintShown = true;
        write(INPUT_DISCARDED_HINT);
      },
    };
    created.handle = deps.createTerminal(MIRROR_TERMINAL_NAME, pty);
    return created;
  }

  return {
    open: () => {
      if (disposed) {
        return;
      }
      if (instance !== null) {
        instance.handle.show(true);
        return;
      }
      instance = createInstance();
      write(READ_ONLY_BANNER);
      // Live mirror only: commands still running are backfilled with
      // their latest tail; finished ones are never replayed.
      for (const [toolUseId, entry] of commands) {
        writeHeader(toolUseId, entry);
        if (entry.lastTail !== null) {
          writeOutput(entry.lastTail);
          instance.writtenTail.set(toolUseId, entry.lastTail);
        }
      }
      instance.handle.show(true);
    },
    commandStarted: (start) => {
      if (disposed) {
        return;
      }
      // tool-start repeats while the tool input streams
      // (tool_call_delta): the first parsed command sticks (same
      // rule as the transcript row) and tail state survives.
      const existing = commands.get(start.toolUseId);
      const command = existing?.command ?? start.command;
      const sessionTag = existing?.sessionTag ?? start.sessionTag;
      const entry: TrackedCommand = {
        ...(command === undefined ? {} : { command }),
        ...(sessionTag === undefined ? {} : { sessionTag }),
        lastTail: existing?.lastTail ?? null,
      };
      commands.set(start.toolUseId, entry);
      // Header waits for a parsed command; a still-streaming input
      // would freeze a truncated `$ …` line into the terminal. The
      // first output snapshot writes it regardless (appendSnapshot).
      if (entry.command !== undefined) {
        writeHeader(start.toolUseId, entry);
      }
    },
    commandOutput: (toolUseId, outputTail) => {
      if (disposed || outputTail.length === 0) {
        return;
      }
      // A progress event can precede a parseable tool_call input;
      // track the command anyway so its output is not dropped.
      const entry = commands.get(toolUseId) ?? { lastTail: null };
      commands.set(toolUseId, entry);
      entry.lastTail = outputTail;
      appendSnapshot(toolUseId, entry, outputTail);
    },
    commandSettled: (toolUseId) => {
      if (disposed) {
        return;
      }
      const entry = commands.get(toolUseId);
      if (entry !== undefined) {
        settleOne(toolUseId, entry);
      }
    },
    settleAll: () => {
      if (disposed) {
        return;
      }
      for (const [toolUseId, entry] of [...commands]) {
        settleOne(toolUseId, entry);
      }
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      instance?.handle.dispose();
      instance = null;
      commands.clear();
    },
  };
}

function headerCommandExcerpt(command: string): string {
  const firstLine = command.split('\n', 1)[0] ?? '';
  const trimmed = firstLine.trim();
  const suffix =
    command.includes('\n') || trimmed.length > MAX_HEADER_COMMAND_LENGTH ? ' …' : '';
  return `${trimmed.slice(0, MAX_HEADER_COMMAND_LENGTH)}${suffix}`;
}

function formatHeaderTime(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
