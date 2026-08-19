import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_OUTPUT_TAIL_LENGTH,
  isExecuteToolName,
  stripTerminalNoise,
  toToolOutputTail,
} from './toolOutput';

describe('stripTerminalNoise', () => {
  it('strips ANSI color runs from failed-command excerpts (#29)', () => {
    // Shape from the user screenshot: PowerShell ParserError with
    // bracketed color codes rendered as literal garbage.
    expect(
      stripTerminalNoise(
        'Error: Command failed (exit code: 1)\n' +
          '\u001b[31;1mParserError: \u001b[0m\n' +
          '\u001b[31;1m\u001b[36;1mLine |\u001b[0m',
      ),
    ).toBe(
      'Error: Command failed (exit code: 1)\nParserError: \nLine |',
    );
  });

  it('applies carriage-return overwrites without trimming', () => {
    expect(stripTerminalNoise('10%\r100%\ndone \n')).toBe(
      '100%\ndone \n',
    );
  });
});

describe('isExecuteToolName', () => {
  it.each(['Execute', 'execute', 'Bash', 'shell', 'tools/Execute'])(
    'classifies %s as execute-class',
    (name) => {
      expect(isExecuteToolName(name)).toBe(true);
    },
  );

  it.each(['Read', 'Grep', 'Task', 'executeplan'])(
    'rejects %s',
    (name) => {
      expect(isExecuteToolName(name)).toBe(false);
    },
  );
});

describe('toToolOutputTail', () => {
  it('normalizes CRLF and trims trailing whitespace', () => {
    expect(toToolOutputTail('one\r\ntwo\r\nthree\n\n')).toBe(
      'one\ntwo\nthree',
    );
  });

  it('keeps only the final frame of carriage-return overwrites', () => {
    expect(
      toToolOutputTail('progress 10%\rprogress 60%\rprogress 100%\ndone'),
    ).toBe('progress 100%\ndone');
  });

  it('strips ANSI escapes and control noise but keeps tabs', () => {
    expect(
      toToolOutputTail(
        '\u001b[32mok\u001b[0m\t\u001b]0;title\u0007value\u0007',
      ),
    ).toBe('ok\tvalue');
  });

  it('returns undefined when nothing displayable remains', () => {
    expect(toToolOutputTail('')).toBeUndefined();
    expect(toToolOutputTail('\u001b[2K\r \n')).toBeUndefined();
  });

  it('bounds long output to a trailing slice cut at a line boundary', () => {
    const line = `${'x'.repeat(99)}\n`;
    const tail = toToolOutputTail(line.repeat(200));

    expect(tail).toBeDefined();
    expect(tail!.length).toBeLessThanOrEqual(
      MAX_TOOL_OUTPUT_TAIL_LENGTH,
    );
    expect(tail!.startsWith('x'.repeat(99))).toBe(true);
    expect(tail!.split('\n').every((l) => l === 'x'.repeat(99))).toBe(
      true,
    );
  });

  it('keeps a single giant line instead of dropping everything', () => {
    const tail = toToolOutputTail('y'.repeat(20_000));

    expect(tail).toBe('y'.repeat(MAX_TOOL_OUTPUT_TAIL_LENGTH));
  });
});
