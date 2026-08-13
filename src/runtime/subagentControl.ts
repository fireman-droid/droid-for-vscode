import {
  ToolConfirmationOutcome,
  type ConnectedDroid,
} from '@factory/droid-sdk';

import { MAX_SUBAGENT_ACTIVITY_LENGTH } from '../shared/subagentProtocol';

/**
 * Host-facing control surface over running Task subagents (待办 B;
 * evidence mission-control-feasibility.md §0.8, probed 2026-08-12):
 *
 * - `sampleActivity` polls `sessions.getMessages(childId, {limit})`
 *   and reports the last tool call observed inside the child session
 *   — the quiet "what it is doing right now" subtitle.
 * - `interrupt` performs the probed stop sequence
 *   `sessions.resume(childId) → interrupt() → detach()`, which stops
 *   exactly that child while its siblings keep running. The resume
 *   attaches with deny-all handlers so the control connection can
 *   never answer permissions on the child's behalf.
 *
 * Both are daemon-only; the extension wires this gateway only while
 * daemon sessions are active, and the host renders no stop control
 * without it (no disabled placeholders — user decision 2026-08-12).
 */
export interface SubagentControlGateway {
  /** Last tool name inside the child, or null when unreadable. */
  sampleActivity(childSessionId: string): Promise<string | null>;
  /** True when the interrupt round-trip completed. */
  interrupt(childSessionId: string): Promise<boolean>;
}

/** Messages fetched per activity sample; newest tail is enough. */
const ACTIVITY_SAMPLE_LIMIT = 40;

export function createDaemonSubagentControl(
  getDroid: () => Promise<ConnectedDroid>,
): SubagentControlGateway {
  return {
    async sampleActivity(childSessionId) {
      try {
        const droid = await getDroid();
        const messages = await droid.sessions.getMessages(
          childSessionId,
          { limit: ACTIVITY_SAMPLE_LIMIT },
        );
        return lastToolName(messages);
      } catch {
        return null;
      }
    },
    async interrupt(childSessionId) {
      try {
        const droid = await getDroid();
        const session = await droid.sessions.resume(childSessionId, {
          permissionHandler: () => ToolConfirmationOutcome.Cancel,
          askUserHandler: () => ({ cancelled: true, answers: [] }),
        });
        try {
          await session.interrupt();
        } finally {
          // Detach only: the child session must stay resumable for
          // the read-only transcript view.
          await session.detach().catch(() => undefined);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Scans a `getMessages` payload back to front for the newest tool
 * call and returns its bounded name. The payload shape is treated as
 * untrusted: every step is structural.
 */
export function lastToolName(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const name = toolNameOf(messages[index]);
    if (name !== null) {
      return name;
    }
  }
  return null;
}

function toolNameOf(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block: unknown = content[index];
    if (
      typeof block !== 'object' ||
      block === null ||
      (block as { type?: unknown }).type !== 'tool_use'
    ) {
      continue;
    }
    const name = (block as { name?: unknown }).name;
    if (typeof name !== 'string') {
      continue;
    }
    const bounded = name
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_SUBAGENT_ACTIVITY_LENGTH)
      .trim();
    if (bounded.length > 0) {
      return bounded;
    }
  }
  return null;
}
