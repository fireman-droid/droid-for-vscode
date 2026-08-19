import type { ConnectedDroid } from '@factory/droid-sdk';

import { MAX_SUBAGENT_ACTIVITY_LENGTH } from '../shared/subagentProtocol';

/**
 * Host-facing observation surface for inline Task subagent cards.
 * Child session ids remain host-only; the public daemon snapshot is
 * sampled only for the newest bounded tool name.
 */
export interface SubagentControlGateway {
  /** Last tool name inside the child, or null when unreadable. */
  sampleActivity(childSessionId: string): Promise<string | null>;
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
