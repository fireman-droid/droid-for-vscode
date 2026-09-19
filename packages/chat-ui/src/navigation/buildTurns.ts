/**
 * Turn grouping helpers for the virtualized transcript. A turn is one
 * user message plus the assistant continuations that follow it; leading
 * assistant-only rows start a turn of their own.
 */

export interface MessageRow {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
}

export interface Turn {
  readonly id: string;
  readonly messageIds: readonly string[];
}

/** Groups runtime messages into stable user-led virtual rows. */
export function buildTurns(messages: readonly MessageRow[]): Turn[] {
  if (messages.length === 0) {
    return [];
  }
  const turns: Array<{ id: string; messageIds: string[] }> = [];
  for (const { id, role } of messages) {
    const last = turns.at(-1);
    if (role === "user" || last === undefined) {
      turns.push({ id, messageIds: [id] });
    } else {
      last.messageIds.push(id);
    }
  }
  return turns;
}

/** User-question ids and their owning turn indexes in document order. */
export function questionTurnRows(
  turns: readonly Turn[],
  roleById: ReadonlyMap<string, MessageRow["role"]>,
): {
  readonly ids: readonly string[];
  readonly indexes: readonly number[];
} {
  const ids: string[] = [];
  const indexes: number[] = [];
  turns.forEach((turn, index) => {
    const lead = turn.messageIds[0];
    if (lead !== undefined && roleById.get(lead) === "user") {
      ids.push(lead);
      indexes.push(index);
    }
  });
  return { ids, indexes };
}

/** Turn index containing a message id, or -1. */
export function turnIndexForMessage(
  turns: readonly Turn[],
  messageId: string,
): number {
  return turns.findIndex(
    (turn) => turn.id === messageId || turn.messageIds.includes(messageId),
  );
}

/** Imperative surface used by the question navigator. */
export interface TranscriptVirtualizerApi {
  readonly scrollToMessageId: (messageId: string) => void;
  readonly questionTops: () => readonly number[];
}
