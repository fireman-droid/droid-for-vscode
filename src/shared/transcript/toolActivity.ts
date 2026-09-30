import { toolNameCandidates, toolPresentation } from './toolCatalog';
export { toolNameCandidates } from './toolCatalog';

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
  const [normalized] = toolNameCandidates(toolName);
  if (normalized.includes('figma')) return displayToolAction(toolName, 'Figma');
  const known = toolPresentation(toolName);
  if (known !== undefined) {
    return known.action;
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
  const [normalized] = toolNameCandidates(toolName);
  const known = toolPresentation(toolName);
  if (known !== undefined) return known.formerAction;
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
