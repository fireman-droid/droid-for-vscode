/**
 * Composer interception for GUI built-in slash commands
 * (slash-parity-assessment.md §5 S2).
 *
 * The Droid CLI treats `/compress` (canonical), `/compact` and
 * `/handoff` (aliases) as the same compaction command, and `/clear`
 * as a near-`/new`; typed into the GUI composer they were previously
 * forwarded to the model as prompt text. Navigation commands map to
 * existing panels — read-only local UI state, so they stay available
 * while a turn runs (CLI busy-policy parity).
 */

export const SLASH_NAV_TARGETS = [
  'model',
  'mcp',
  'skills',
  'sessions',
  'context',
] as const;
export type SlashNavTarget = (typeof SLASH_NAV_TARGETS)[number];

/** `/` popup rows for the navigation commands (Built-in group). */
export const SLASH_NAV_COMMANDS: readonly {
  readonly name: SlashNavTarget;
  readonly description: string;
}[] = [
  { name: 'model', description: 'Choose model and reasoning' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'skills', description: 'Browse and toggle skills' },
  { name: 'sessions', description: 'Open session history' },
  { name: 'context', description: 'Review context usage' },
];

export type BuiltinSlashAction =
  | { readonly kind: 'compact' }
  | { readonly kind: 'new' }
  | { readonly kind: 'navigate'; readonly target: SlashNavTarget }
  | { readonly kind: 'btw'; readonly question: string }
  | { readonly kind: 'canvas'; readonly request: string }
  | { readonly kind: 'removed' };

export const CANVAS_REQUEST_TEMPLATE =
  'Create an interactive Canvas artifact for:\n\n' +
  '[Describe the result, audience, and key interactions]';

/** CLI-parity aliases onto the existing compaction pipeline. */
const COMPACT_ALIASES = new Set(['compact', 'compress', 'handoff']);

/**
 * `/clear` keeps the CLI's "start over" intent through `session.new`;
 * the CLI additionally preserves model/autonomy, a semantic
 * difference accepted as-is (assessment §4.1).
 */
const NEW_ALIASES = new Set(['new', 'clear']);

const NAV_TARGETS = new Set<string>(SLASH_NAV_TARGETS);

/**
 * Resolves composer text to a built-in slash action, or null when the
 * text should be sent to the model as a normal prompt. Alias and
 * navigation commands take no arguments, so they only match as the
 * whole (trimmed) input; `/btw` carries the rest as the question and
 * only resolves when the host advertised side-chat support
 * (fail closed in daemon mode).
 */
export function resolveBuiltinSlash(
  text: string,
  options: { readonly btwEnabled: boolean },
): BuiltinSlashAction | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const spaceIndex = trimmed.search(/\s/);
  const slug = (
    spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)
  ).toLowerCase();
  const rest = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  if (slug === 'btw') {
    return options.btwEnabled
      ? { kind: 'btw', question: rest.trim() }
      : null;
  }
  if (slug === 'mission') {
    return { kind: 'removed' };
  }
  if (slug === 'canvas') {
    return { kind: 'canvas', request: rest.trim() };
  }
  if (rest.length > 0) {
    return null;
  }
  if (COMPACT_ALIASES.has(slug)) {
    return { kind: 'compact' };
  }
  if (NEW_ALIASES.has(slug)) {
    return { kind: 'new' };
  }
  if (NAV_TARGETS.has(slug)) {
    return { kind: 'navigate', target: slug as SlashNavTarget };
  }
  return null;
}
