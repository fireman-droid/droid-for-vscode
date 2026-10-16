import { describe, expect, it, vi } from 'vitest';
import { AutonomyLevel } from '@factory/droid-sdk';
import { restrictBtwTools } from './btwToolPolicy';
import type { BtwAnalysisTools } from './btwAnalysisTools';

function fixture(ignoreRestriction = false) {
  const tools = [
    ['read-cli', 'Read', 'read'], ['grep_tool_cli', 'Grep', 'read'],
    ['ls-cli', 'LS', 'read'], ['glob-search-cli', 'Glob', 'read'],
    ['web_search', 'WebSearch', 'read'], ['fetch_url', 'FetchUrl', 'read'],
    ['apply-patch-cli', 'ApplyPatch', 'edit'], ['execute-cli', 'Execute', 'execute'],
    ['task-cli', 'Task', 'execute'], ['stage_settings_changes', 'StageSettingsChanges', 'read'],
    ['mcp_files_update', 'files___update', 'read'], ['generate-image', 'GenerateImage', 'read'],
    ['automation-create-cli', 'CreateAutomation', 'execute'],
    ['tool-search-cli', 'ToolSearch', 'execute'],
  ].map(([id, llmId, category]) => ({
    id, llmId, category, displayName: llmId, description: '',
    defaultAllowed: true, currentlyAllowed: true,
  }));
  let disabled: string[] = [];
  const client = {
    loadSession: vi.fn(async (params: { sessionId: string; disabledToolIds?: string[] }) => {
      disabled = params.disabledToolIds ?? disabled;
      return {};
    }),
    updateSessionSettings: vi.fn(async () => ({})),
    listTools: vi.fn(async () => ({ result: { tools: tools.map(tool => ({
      ...tool, currentlyAllowed: tool.currentlyAllowed && (ignoreRestriction
        || tool.llmId === 'ToolSearch' || !disabled.includes(tool.llmId!)),
    })) } })),
  };
  return { client, tools, api: client as unknown as Parameters<typeof restrictBtwTools>[0] };
}

describe('BTW tool restrictions', () => {
  it('retains code reading and search, but blocks edits, commands, delegation and MCP writes even labelled read', async () => {
    const { api, client } = fixture();
    const policy = await restrictBtwTools(api, 'fork-1', true);
    const tools = (await client.listTools()).result.tools;
    expect(tools.filter(tool => tool.currentlyAllowed).map(tool => tool.llmId)).toEqual([
      'Read', 'Grep', 'LS', 'Glob', 'WebSearch', 'FetchUrl', 'ToolSearch',
    ]);
    expect(policy.disabledToolIds).toEqual(expect.arrayContaining(['Create', 'Edit', 'ApplyPatch']));
    expect(client.loadSession.mock.calls.every(([params]) => params.sessionId === 'fork-1')).toBe(true);
    expect(client.updateSessionSettings).toHaveBeenCalledWith({ autonomyLevel: AutonomyLevel.Off });
    expect(client.loadSession).toHaveBeenLastCalledWith({ sessionId: 'fork-1', ...policy });
  });

  it('keeps Review questions tool-free', async () => {
    const { api, client } = fixture();
    await restrictBtwTools(api, 'review-fork', false);
    expect((await client.listTools()).result.tools.filter(tool => tool.currentlyAllowed)
      .map(tool => tool.llmId)).toEqual(['ToolSearch']);
  });

  it('does not re-enable a reader disabled in the parent', async () => {
    const { api, tools, client } = fixture();
    tools[0]!.currentlyAllowed = false;
    await restrictBtwTools(api, 'fork-1', true);
    expect(client.loadSession).toHaveBeenLastCalledWith(expect.objectContaining({
      disabledToolIds: expect.arrayContaining(['Read']),
    }));
  });

  it('rejects a backend which leaves a mutating tool enabled', async () => {
    const { api } = fixture(true);
    await expect(restrictBtwTools(api, 'fork-1', true)).rejects.toThrow('could not enforce read-only');
  });

  it('does not continue without a tool catalogue', async () => {
    const { api, client } = fixture();
    client.listTools.mockRejectedValueOnce(new Error('catalogue unavailable'));
    await expect(restrictBtwTools(api, 'fork-1', true)).rejects.toThrow('catalogue unavailable');
    expect(client.loadSession).toHaveBeenCalledTimes(1);
  });

  it('retains owned analysis tools while rejecting other MCP tools', async () => {
    const { api, client, tools } = fixture();
    tools.push({ id: 'mcp-owned', llmId: 'owned___run_javascript', category: 'read', displayName: 'analysis', description: '', defaultAllowed: true, currentlyAllowed: true });
    const analysis: BtwAnalysisTools = { mcpServers: [], toolIds: new Set(['owned___run_javascript']), cancel() {}, async close() {} };
    const policy = await restrictBtwTools(api, 'fork-1', true, analysis);
    expect(policy.autoRejectPermissionRequests).toBe(false);
    expect((await client.listTools()).result.tools.find(tool => tool.llmId === 'owned___run_javascript')?.currentlyAllowed).toBe(true);
    expect(policy.disabledToolIds).toContain('files___update');
    tools.pop();
    await expect(restrictBtwTools(api, 'fork-1', true, analysis)).rejects.toThrow('could not load');
  });
});
