import type { McpServerAddMessage, McpServerType } from '../../../shared/protocol/settings';

export type McpServerDraft = Omit<McpServerAddMessage, 'type' | 'sessionId'>;

export function readMcpServerDraft(name: string, serverType: McpServerType, target: string): {
  readonly draft: McpServerDraft | null;
  readonly targetHint: string | null;
} {
  const trimmedName = name.trim();
  const trimmedTarget = target.trim();
  const targetValid = serverType === 'stdio'
    ? trimmedTarget.length > 0
    : /^https?:\/\//.test(trimmedTarget);
  const targetHint = serverType !== 'stdio' && trimmedTarget.length > 0 && !targetValid
    ? 'Enter a URL starting with http:// or https://.'
    : null;
  if (trimmedName.length === 0 || !targetValid) return { draft: null, targetHint };
  if (serverType !== 'stdio') {
    return { draft: { name: trimmedName, serverType, url: trimmedTarget }, targetHint };
  }
  const [command = '', ...args] = trimmedTarget.split(/\s+/);
  return {
    draft: { name: trimmedName, serverType, command, ...(args.length > 0 ? { args } : {}) },
    targetHint,
  };
}
