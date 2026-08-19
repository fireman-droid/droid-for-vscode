// composerCommands: moved verbatim from Thread.tsx (structure-only refactor).

import {
  MAX_COMMAND_NAME_LENGTH,
  MAX_FILE_SEARCH_QUERY_LENGTH,
  type CommandSummary,
} from "../../../shared/bridgeMessages";
import type { SlashNavTarget } from "../slashBuiltins";
import type { SlashCommandsState } from "../Thread";

export interface MentionToken {
  /** Index of the `@` character in the draft. */
  readonly start: number;
  /** Caret position; the token spans start..end. */
  readonly end: number;
  readonly query: string;
}

/**
 * Splits a forward-slash relative path into the file name and its
 * containing directory for the two-part mention row (name leads,
 * dimmed directory follows).
 */
export function splitMentionPath(path: string): {
  readonly name: string;
  readonly directory: string;
} {
  const separator = path.lastIndexOf("/");
  if (separator < 0) {
    return { name: path, directory: "" };
  }
  return {
    name: path.slice(separator + 1),
    directory: path.slice(0, separator),
  };
}

/**
 * Finds an `@file` mention token ending at the caret. The `@` must
 * not directly follow an ASCII word character, `@`, or the email-like
 * `.`/`-` (so `user@host` never triggers); anything else — start of
 * draft, whitespace, CJK text, punctuation — allows the mention.
 */
export function findMentionToken(
  value: string,
  caret: number,
): MentionToken | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) {
    return null;
  }
  const preceding = before[at - 1];
  if (preceding !== undefined && /[A-Za-z0-9_@.-]/.test(preceding)) {
    return null;
  }
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query) || query.length > MAX_FILE_SEARCH_QUERY_LENGTH) {
    return null;
  }
  return { start: at, end: caret, query };
}

export interface SlashToken {
  /** Caret position; the token spans 0..end. */
  readonly end: number;
  readonly query: string;
}

/**
 * GUI-provided slash commands. Both route through existing bridge
 * channels (`session.compact`, `session.new`) via the `handleSend`
 * interception in App.tsx — no invented Droid capabilities.
 */
export const BUILT_IN_COMMANDS = [
  {
    name: "compact",
    description: "Summarize earlier messages to free context",
  },
  { name: "new", description: "Start a new session" },
  { name: "canvas", description: "Create an interactive result artifact" },
] as const;

/**
 * `/btw` completes to `/btw ` like other built-ins; App.tsx routes
 * the sent text onto the side-chat card instead of the model. Only
 * offered while the host advertises the capability.
 */
export const BTW_COMMAND = {
  name: "btw",
  description: "Ask a side question without touching this chat",
} as const;

/** Opens the official Factory Mission setup without sending a turn. */
export const MISSION_COMMAND = {
  name: "mission",
  description: "Start a Factory Mission",
} as const;

/** Most enabled skills offered in the `/` popup Skills section. */
export const MAX_SLASH_SKILL_MATCHES = 5;

/** One selectable row in the `/` popup, across all sections. */
export type SlashEntry =
  | { readonly kind: "builtin"; readonly name: string; readonly description: string }
  | {
      readonly kind: "nav";
      readonly name: SlashNavTarget;
      readonly description: string;
    }
  | { readonly kind: "command"; readonly command: CommandSummary }
  | {
      readonly kind: "skill";
      readonly name: string;
      readonly description: string | null;
    };

/**
 * Finds a `/command` token when the draft starts with `/` and the
 * caret is still inside the command slug (no whitespace typed yet).
 */
export function findSlashToken(
  value: string,
  caret: number,
): SlashToken | null {
  if (!value.startsWith("/") || caret < 1) {
    return null;
  }
  const query = value.slice(1, caret);
  if (/[\s/@]/.test(query) || query.length > MAX_COMMAND_NAME_LENGTH) {
    return null;
  }
  return { end: caret, query };
}

/**
 * Filters the catalog to non-executable commands matching the typed
 * query, recent commands first, the rest alphabetical.
 */
export function filterSlashCommands(
  commands: SlashCommandsState,
  query: string,
): readonly CommandSummary[] {
  const lowered = query.toLowerCase();
  const matches = commands.items.filter(
    (item) =>
      !item.isExecutable &&
      (lowered.length === 0 || item.name.toLowerCase().includes(lowered)),
  );
  const recentRank = new Map(
    commands.recent.map((name, index) => [name, index]),
  );
  return [...matches].sort((a, b) => {
    const rankA = recentRank.get(a.name) ?? Number.POSITIVE_INFINITY;
    const rankB = recentRank.get(b.name) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.name.localeCompare(b.name);
  });
}
