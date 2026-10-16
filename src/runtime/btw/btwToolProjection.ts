import { extractToolTarget } from '../tools/toolDetail';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/protocol/interactionProtocol';
import { MAX_BTW_TOOLS, MAX_BTW_TOOL_CODE, MAX_BTW_TOOL_OUTPUT, type BtwToolActivity } from '../../shared/protocol/btwToolActivity';

export interface BtwToolEvent { readonly kind: 'tool'; readonly tool: BtwToolActivity }

/** Normalizes process notifications and daemon stream events for one turn. */
export class BtwToolProjection {
  private readonly tools = new Map<string, BtwToolActivity>();
  constructor(private readonly cwd?: string) {}

  project(raw: Record<string, unknown>): BtwToolEvent | null {
    if (raw.type === 'tool_call' || raw.type === 'tool_call_delta') {
      const use = record(raw.toolUse) ?? raw;
      const id = use.id ?? raw.toolUseId;
      if (typeof id !== 'string' || !id || id.length > MAX_BRIDGE_ID_LENGTH || typeof use.name !== 'string' || !use.name) return null;
      const old = this.tools.get(id);
      if (old && old.state !== 'running') return null;
      const name = use.name.slice(0, 160);
      const input = record(use.input) ?? {};
      const kind = toolKind(name);
      const target = kind === 'git' && typeof input.query === 'string' ? input.query : extractToolTarget(name, input, this.cwd);
      const code = kind === 'analysis' && typeof input.code === 'string' ? input.code : undefined;
      const tool: BtwToolActivity = {
        ...old, id, name, kind, state: 'running',
        ...(target ? { target: target.slice(0, 512) } : {}),
        ...(code === undefined ? {} : { code: code.slice(0, MAX_BTW_TOOL_CODE),
          language: input.language === 'typescript' ? 'typescript' : 'javascript',
          ...(code.length > MAX_BTW_TOOL_CODE ? { detailsOmitted: true } : {}) }),
      };
      this.tools.set(id, tool);
      if (this.tools.size > MAX_BTW_TOOLS) this.tools.delete(this.tools.keys().next().value!);
      return { kind: 'tool', tool };
    }
    if (raw.type !== 'tool_result' || typeof raw.toolUseId !== 'string') return null;
    const old = this.tools.get(raw.toolUseId);
    if (!old) return null;
    const content = resultText(raw.content);
    let state: BtwToolActivity['state'] = raw.isError === true ? 'error' : 'done';
    let output: string | undefined;
    let error: string | undefined = raw.isError === true ? content || 'Tool execution failed.' : undefined;
    if (old.kind === 'analysis' && raw.isError !== true) {
      let result: Record<string, unknown> | null = null;
      try { result = record(JSON.parse(content)); } catch { /* A non-structured result cannot confirm execution. */ }
      state = result?.ok === true ? 'done' : result?.ok === false ? 'error' : 'incomplete';
      output = [result?.output, result?.value].filter((part): part is string => typeof part === 'string' && !!part).join('\n');
      error = typeof result?.error === 'string' ? result.error : state === 'error' ? 'Example execution failed.' : undefined;
    } else if (old.kind === 'git') output = content;
    const tool: BtwToolActivity = { ...old, state,
      ...(output === undefined ? {} : { output: output.slice(0, MAX_BTW_TOOL_OUTPUT) }),
      ...(error === undefined ? {} : { error: error.slice(0, 1_000) }),
      ...(output && output.length > MAX_BTW_TOOL_OUTPUT ? { detailsOmitted: true } : {}) };
    this.tools.set(tool.id, tool);
    return { kind: 'tool', tool };
  }
}

function toolKind(name: string): BtwToolActivity['kind'] {
  if (/^btw-[a-f0-9]{24}___run_javascript$/.test(name)) return 'analysis';
  if (/^btw-[a-f0-9]{24}___git_query$/.test(name)) return 'git';
  if (name === 'Read') return 'read';
  if (['Grep', 'Glob', 'LS', 'ToolSearch'].includes(name)) return 'search';
  if (['FetchUrl', 'WebSearch'].includes(name)) return 'web';
  return 'other';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(item => record(item)?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
}
