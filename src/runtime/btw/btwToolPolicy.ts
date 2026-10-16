import {
  AutonomyLevel, DroidClient, ListToolsResultSchema, ProcessTransport,
  type LoadSessionRequestParams,
} from '@factory/droid-sdk/node';
import type { BtwAnalysisTools } from './btwAnalysisTools';

// Tool categories are not a permission boundary: MCP writes, image generation
// and settings changes can all be advertised as "read" by the CLI.
const READ_TOOLS = new Map([
  ['read-cli', 'Read'], ['ls-cli', 'LS'], ['glob-search-cli', 'Glob'],
  ['grep_tool_cli', 'Grep'], ['web_search', 'WebSearch'], ['fetch_url', 'FetchUrl'],
  ['automation-list-cli', 'ListAutomations'], ['automation-read-cli', 'ReadAutomation'],
  ['automation-templates-list-cli', 'ListAutomationTemplates'],
  ['task-output-cli', 'TaskOutput'],
]);
// These edit variants can change with the selected model.
const EDIT_TOOLS = ['Create', 'Edit', 'ApplyPatch'];
export type BtwToolPolicy = Pick<LoadSessionRequestParams,
  'disabledToolIds' | 'autoRejectPermissionRequests' | 'disableBuiltinSkills' | 'mcpServers'>;
type PolicyClient = Pick<DroidClient, 'loadSession' | 'listTools' | 'updateSessionSettings'>;

/** Restrict only a hidden fork; never call this with the main session ID. */
export async function restrictBtwTools(
  client: PolicyClient, sessionId: string, allowReading: boolean, analysis?: BtwAnalysisTools,
): Promise<BtwToolPolicy> {
  const policy: BtwToolPolicy = {
    autoRejectPermissionRequests: !(allowReading && analysis), disableBuiltinSkills: true,
    ...(allowReading && analysis ? { mcpServers: analysis.mcpServers } : {}),
  };
  await client.loadSession({ sessionId, ...policy });
  await client.updateSessionSettings({ autonomyLevel: AutonomyLevel.Off });
  const { tools } = ListToolsResultSchema.parse((await client.listTools()).result);
  const isReadable = (tool: typeof tools[number]): boolean =>
    allowReading && (READ_TOOLS.get(tool.id) === tool.llmId || analysis?.toolIds.has(tool.llmId) === true);
  policy.disabledToolIds = [...new Set([
    ...EDIT_TOOLS, ...tools.filter(tool => !isReadable(tool) || !tool.currentlyAllowed).map(tool => tool.llmId),
  ])];
  await client.loadSession({ sessionId, ...policy });
  const restricted = ListToolsResultSchema.parse((await client.listTools()).result);
  if (allowReading && analysis && [...analysis.toolIds].some(id =>
    !restricted.tools.some(tool => tool.llmId === id && tool.currentlyAllowed))) {
    throw new Error('Droid could not load the isolated BTW analysis tools.');
  }
  // ToolSearch remains enabled in Droid even when disabled; it discovers
  // schemas, but cannot execute the disabled tools it describes.
  if (restricted.tools.some(tool => tool.currentlyAllowed && !isReadable(tool)
    && !(tool.id === 'tool-search-cli' && tool.llmId === 'ToolSearch'))) {
    throw new Error('Droid could not enforce read-only tools for this side question.');
  }
  return policy;
}

/** The daemon SDK has no native tool catalogue, so inspect the idle fork
 * through the public process client before attaching it to the daemon. */
export async function prepareBtwToolPolicy(cwd: string, sessionId: string, analysis?: BtwAnalysisTools): Promise<BtwToolPolicy> {
  const transport = new ProcessTransport({ cwd });
  try {
    await transport.connect();
    return await restrictBtwTools(new DroidClient({ transport }), sessionId, true, analysis);
  } finally {
    await transport.close();
  }
}
