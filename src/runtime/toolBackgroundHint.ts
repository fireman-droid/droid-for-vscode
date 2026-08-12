import type { ToolBackgroundHint } from '../shared/bridgeMessages';

/**
 * Fail-soft read of the Execute tool's `fireAndForget` input flag.
 * The field exists only in the SDK's bundled ExecuteToolInputSchema
 * (never exported to the .d.ts type surface), so this narrows at
 * runtime and treats anything but a literal `true` on an
 * execute-class tool as "no hint" — a missing, renamed, or malformed
 * field changes nothing (probe: artifacts/probe-fire-and-forget-
 * conclusions.md, CLI 0.193.0).
 */
export function extractToolBackgroundHint(
  toolName: string,
  input: unknown,
): ToolBackgroundHint | undefined {
  const normalized = toolName
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  if (normalized !== 'execute') {
    return undefined;
  }
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return record['fireAndForget'] === true
    ? { fireAndForget: true }
    : undefined;
}
