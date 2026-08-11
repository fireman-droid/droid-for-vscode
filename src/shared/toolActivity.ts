export const MAX_TOOL_ACTION_SUMMARY_LENGTH = 160;
export const MAX_TOOL_PROGRESS_UPDATES_PER_TOOL = 100;

export const TOOL_ACTIVITY_UPDATE_KINDS = [
  'tool-call',
  'tool-result',
  'error',
  'status',
  'message',
] as const;

export type ToolActivityUpdateKind =
  (typeof TOOL_ACTIVITY_UPDATE_KINDS)[number];

const KNOWN_TOOL_ACTIONS: Readonly<Record<string, string>> = {
  applypatch: 'Updated workspace files',
  askuser: 'Requested your input',
  create: 'Created workspace files',
  edit: 'Updated workspace files',
  execute: 'Ran a local command',
  exitspecmode: 'Prepared an implementation plan',
  fetchurl: 'Researched an external source',
  glob: 'Inspected workspace structure',
  grep: 'Searched workspace content',
  ls: 'Inspected workspace structure',
  read: 'Read workspace files',
  skill: 'Loaded workflow guidance',
  task: 'Delegated focused work',
  taskoutput: 'Checked delegated work',
  todowrite: 'Updated the task plan',
  websearch: 'Researched external sources',
  write: 'Updated workspace files',
};

export function summarizeToolAction(toolName: string): string {
  const safeName = toolName.replace(/\p{Cc}/gu, '').trim();
  const leaf = safeName.split(/[.:/]/u).at(-1) ?? safeName;
  const normalized = safeName
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  const normalizedLeaf = leaf
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  const known =
    KNOWN_TOOL_ACTIONS[normalized] ??
    KNOWN_TOOL_ACTIONS[normalizedLeaf];
  if (known !== undefined) {
    return known;
  }
  if (normalized.includes('figma')) {
    return 'Inspected the design';
  }
  if (normalized.includes('browser')) {
    return 'Verified the interface';
  }

  const humanized = leaf
    .replace(/___+/gu, ' ')
    .replace(/[_-]+/gu, ' ')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (humanized.length === 0) {
    return 'Used a workspace tool';
  }
  const prefix = 'Used ';
  return `${prefix}${humanized.slice(
    0,
    MAX_TOOL_ACTION_SUMMARY_LENGTH - prefix.length,
  )}`;
}
