import { hasExactKeys } from '../validation/strictValidation';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';

export const MAX_BTW_TOOLS = 24;
export const MAX_BTW_TOOL_CODE = 32_000;
export const MAX_BTW_TOOL_OUTPUT = 16_000;
export const MAX_BTW_TOOL_TEXT = 64_000;
export const BTW_TOOL_KINDS = ['read', 'search', 'web', 'git', 'analysis', 'other'] as const;
export const BTW_TOOL_STATES = ['running', 'done', 'error', 'incomplete'] as const;

/** Display-only projection. Never forward arbitrary tool arguments to the webview. */
export interface BtwToolActivity {
  readonly id: string;
  readonly name: string;
  readonly kind: typeof BTW_TOOL_KINDS[number];
  readonly state: typeof BTW_TOOL_STATES[number];
  readonly target?: string;
  readonly code?: string;
  readonly language?: 'javascript' | 'typescript';
  readonly output?: string;
  readonly error?: string;
  readonly detailsOmitted?: boolean;
}

export function isBtwToolActivities(value: unknown): value is readonly BtwToolActivity[] {
  if (!Array.isArray(value) || value.length > MAX_BTW_TOOLS) return false;
  const ids = new Set<string>();
  let textLength = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || !hasExactKeys(item, ['id', 'name', 'kind', 'state'],
      ['target', 'code', 'language', 'output', 'error', 'detailsOmitted']) ||
      !bounded(item.id, MAX_BRIDGE_ID_LENGTH) || !item.id || ids.has(item.id) ||
      !bounded(item.name, 160) || !item.name || !BTW_TOOL_KINDS.includes(item.kind) ||
      !BTW_TOOL_STATES.includes(item.state) ||
      (item.target !== undefined && !bounded(item.target, 512)) ||
      (item.code !== undefined && !bounded(item.code, MAX_BTW_TOOL_CODE)) ||
      (item.output !== undefined && !bounded(item.output, MAX_BTW_TOOL_OUTPUT)) ||
      (item.error !== undefined && !bounded(item.error, 1_000)) ||
      (item.language !== undefined && !['javascript', 'typescript'].includes(item.language)) ||
      (item.detailsOmitted !== undefined && typeof item.detailsOmitted !== 'boolean')) return false;
    ids.add(item.id);
    textLength += (item.code?.length ?? 0) + (item.output?.length ?? 0);
  }
  return textLength <= MAX_BTW_TOOL_TEXT;
}

export function retainBtwTools(tools: readonly BtwToolActivity[]): readonly BtwToolActivity[] {
  let remaining = MAX_BTW_TOOL_TEXT;
  return tools.slice(-MAX_BTW_TOOLS).reverse().map(tool => {
    const length = (tool.code?.length ?? 0) + (tool.output?.length ?? 0);
    if (length <= remaining) { remaining -= length; return tool; }
    const { code: _code, output: _output, ...summary } = tool;
    return { ...summary, detailsOmitted: true };
  }).reverse();
}

function bounded(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}
