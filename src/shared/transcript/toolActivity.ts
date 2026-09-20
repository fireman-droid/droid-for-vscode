export const MAX_TOOL_ACTION_SUMMARY_LENGTH = 160;
export const MAX_TOOL_PROGRESS_UPDATES_PER_TOOL = 100;

export const TOOL_ACTIVITY_UPDATE_KINDS = [
  'tool-call',
  'tool-result',
  'error',
  'status',
  'message',
] as const;

export type ToolActivityUpdateKind = (typeof TOOL_ACTIVITY_UPDATE_KINDS)[number];

// Current action title followed by its former generated title. The latter
// identifies cached defaults without rewriting model-authored summaries.
const KNOWN_TOOL_ACTIONS: Readonly<Record<string, readonly [string, string]>> = {
  applypatch: ['Apply patch', 'Updated workspace files'],
  askuser: ['Ask for input', 'Requested your input'],
  create: ['Create file', 'Created workspace files'],
  edit: ['Edit file', 'Updated workspace files'],
  execute: ['Run command', 'Ran a local command'],
  exitspecmode: ['Present implementation plan', 'Prepared an implementation plan'],
  fetchurl: ['Fetch URL', 'Researched an external source'],
  glob: ['Find files', 'Inspected workspace structure'],
  grep: ['Search files', 'Searched workspace content'],
  ls: ['List directory', 'Inspected workspace structure'],
  read: ['Read file', 'Read workspace files'],
  skill: ['Load skill', 'Loaded workflow guidance'],
  task: ['Delegate task', 'Delegated focused work'],
  taskoutput: ['Check task output', 'Checked delegated work'],
  todowrite: ['Update task plan', 'Updated the task plan'],
  websearch: ['Search web', 'Researched external sources'],
  write: ['Write file', 'Updated workspace files'],
};

const BROWSER_TOOL_ACTIONS: Readonly<Record<string, string>> = {
  back: 'Go back',
  forward: 'Go forward',
  reload: 'Reload page',
  clearbrowserenv: 'Clear browser environment',
  executebrowseraction: 'Run browser action',
  targets: 'Browser tabs',
  tabs: 'Browser tabs',
  attach: 'Attach browser',
  detach: 'Detach browser',
  viewport: 'Set viewport',
  screenshot: 'Capture screenshot',
  takescreenshot: 'Capture screenshot',
  snapshot: 'Inspect page',
  inspectpage: 'Inspect page',
  click: 'Click element',
  navigate: 'Navigate page',
  open: 'Open page',
  close: 'Close page',
  type: 'Type text',
  fillform: 'Fill form',
  presskey: 'Press key',
  hover: 'Hover element',
  selectoption: 'Select option',
  waitfor: 'Wait for page',
  evaluate: 'Evaluate script',
  get: 'Read browser state',
  action: 'Run browser action',
  assert: 'Check browser assertion',
  diagnose: 'Diagnose browser',
  network: 'Inspect network',
  result: 'Read browser result',
  upload: 'Upload file',
  clear: 'Clear browser state',
  cdp: 'Run browser protocol command',
  consolemessages: 'Inspect console',
  networkrequests: 'Inspect network',
};

/**
 * Lookup keys a raw SDK tool name may match under: the full name and
 * its namespace leaf, both stripped to lowercase alphanumerics. Shared
 * by Runtime input classification and the webview activity grouping.
 * Display-only MCP leaf parsing must not expand these trusted matches.
 */
export function toolNameCandidates(toolName: string): readonly [string, string] {
  const safeName = toolName.replace(/\p{Cc}/gu, '').trim();
  const leaf = safeName.split(/[.:/]/u).at(-1) ?? safeName;
  return [
    safeName.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase(),
    leaf.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase(),
  ];
}

/** Browser activity describes the requested action, not a verification result. */
export function browserToolAction(toolName: string): string | undefined {
  const [normalized] = toolNameCandidates(toolName);
  if (!normalized.includes('browser')) return undefined;
  const normalizedLeaf = displayToolLeaf(toolName).replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  const browserIndex = normalizedLeaf.lastIndexOf('browser');
  const action = browserIndex < 0 ? normalizedLeaf : normalizedLeaf.slice(browserIndex + 7);
  return ownAction(BROWSER_TOOL_ACTIONS, normalizedLeaf) ?? ownAction(BROWSER_TOOL_ACTIONS, action) ??
    displayToolAction(toolName, 'Browser');
}

/** Refresh former generated labels while retaining custom summaries. */
export function resolveToolAction(toolName: string, action?: string): string {
  return action === undefined || action === legacyToolAction(toolName)
    ? summarizeToolAction(toolName)
    : action;
}

export function summarizeToolAction(toolName: string): string {
  const browserAction = browserToolAction(toolName);
  if (browserAction !== undefined) return browserAction;
  const [normalized, normalizedLeaf] = toolNameCandidates(toolName);
  if (normalized.includes('figma')) return displayToolAction(toolName, 'Figma');
  const known = ownAction(KNOWN_TOOL_ACTIONS, normalized) ?? ownAction(KNOWN_TOOL_ACTIONS, normalizedLeaf);
  if (known !== undefined) {
    return known[0];
  }
  return displayToolAction(toolName);
}

function displayToolAction(toolName: string, family?: 'Browser' | 'Figma'): string {
  let leaf = displayToolLeaf(toolName);
  if (family && leaf.toLocaleLowerCase().startsWith(family.toLocaleLowerCase())) {
    leaf = leaf.slice(family.length);
  }
  const humanized = humanizeToolLeaf(leaf);
  const title = humanized.length === 0 ? '' : humanized[0]!.toLocaleUpperCase() + humanized.slice(1);
  return (family ? `${family}${title ? ` · ${title}` : ''}` : title || 'Tool')
    .slice(0, MAX_TOOL_ACTION_SUMMARY_LENGTH);
}

function displayToolLeaf(toolName: string): string {
  const safeName = toolName.replace(/\p{Cc}/gu, '').trim();
  return safeName.split(/[.:/]|__+/u).at(-1) ?? safeName;
}

function legacyToolAction(toolName: string): string {
  const [normalized, normalizedLeaf] = toolNameCandidates(toolName);
  const known = ownAction(KNOWN_TOOL_ACTIONS, normalized) ?? ownAction(KNOWN_TOOL_ACTIONS, normalizedLeaf);
  if (known !== undefined) return known[1];
  if (normalized.includes('figma')) return 'Inspected the design';
  if (normalized.includes('browser')) return 'Verified the interface';
  const safeName = toolName.replace(/\p{Cc}/gu, '').trim();
  const humanized = humanizeToolLeaf(safeName.split(/[.:/]/u).at(-1) ?? safeName);
  return humanized.length === 0
    ? 'Used a workspace tool'
    : `Used ${humanized.slice(0, MAX_TOOL_ACTION_SUMMARY_LENGTH - 5)}`;
}

function humanizeToolLeaf(leaf: string): string {
  return leaf
    .replace(/___+/gu, ' ')
    .replace(/[_-]+/gu, ' ')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function ownAction<T>(actions: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(actions, key) ? actions[key] : undefined;
}
