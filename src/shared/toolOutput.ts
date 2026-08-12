import { toolNameCandidates } from './toolActivity';

/**
 * Longest command-output tail one tool activity row may carry across
 * the bridge (tier1 §1: trailing ≤8K characters, cut at a line
 * boundary). The SDK's `tool_progress` updates deliver the cumulative
 * `fullOutput` for Execute runs (probe 2026-08-12,
 * `artifacts/probe-tool-progress-output.out.json`), so the tail is a
 * stateless slice per event rather than a cross-event ring buffer.
 */
export const MAX_TOOL_OUTPUT_TAIL_LENGTH = 8_000;

/**
 * Widest raw window inspected per progress event before sanitizing.
 * `fullOutput` grows with the whole command output; slicing first
 * keeps per-event work bounded for megabyte-scale build logs.
 */
const RAW_OUTPUT_WINDOW = MAX_TOOL_OUTPUT_TAIL_LENGTH * 4;

/** Terminal-style escape sequences (CSI and OSC) stripped for display. */
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/gu;

const EXECUTE_TOOL_NAMES: readonly string[] = [
  'execute',
  'bash',
  'shell',
];

/** Whether a tool runs local commands (the output-preview scope). */
export function isExecuteToolName(toolName: string): boolean {
  return toolNameCandidates(toolName).some((candidate) =>
    EXECUTE_TOOL_NAMES.includes(candidate),
  );
}

/**
 * Display tail of one command's cumulative output: carriage-return
 * overwrites applied (progress bars keep only their final frame),
 * ANSI escapes and control noise stripped, bounded to the trailing
 * `MAX_TOOL_OUTPUT_TAIL_LENGTH` characters cut at a line boundary.
 * Returns undefined when nothing displayable remains.
 */
export function toToolOutputTail(raw: string): string | undefined {
  const windowed = raw.slice(-RAW_OUTPUT_WINDOW);
  const sanitized = windowed
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n')
    .replace(ANSI_PATTERN, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '')
    .trimEnd();
  if (sanitized.length <= MAX_TOOL_OUTPUT_TAIL_LENGTH) {
    return sanitized.length === 0 ? undefined : sanitized;
  }
  const sliced = sanitized.slice(-MAX_TOOL_OUTPUT_TAIL_LENGTH);
  const firstBreak = sliced.indexOf('\n');
  // Drop the partial first line unless the tail is one giant line.
  const tail =
    firstBreak === -1 ? sliced : sliced.slice(firstBreak + 1);
  return tail.length === 0 ? undefined : tail;
}
