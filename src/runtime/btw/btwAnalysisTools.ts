import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, tool, ToolConfirmationOutcome, type LoadSessionRequestParams, type RequestPermissionRequestParams } from '@factory/droid-sdk/node';
import { z } from 'zod';
import { BtwAnalysisRunner } from './btwAnalysisRunner';
import { queryBtwGit, readBtwSnapshots } from './btwAnalysisIO';

export interface BtwAnalysisTools {
  readonly mcpServers: NonNullable<LoadSessionRequestParams['mcpServers']>;
  readonly toolIds: ReadonlySet<string>;
  cancel(): void;
  close(): Promise<void>;
}

export function canRunBtwAnalysisTool(params: RequestPermissionRequestParams, tools?: BtwAnalysisTools): boolean {
  return !!tools && params.toolUses.length > 0
    && params.toolUses.every(use => tools.toolIds.has(use.toolUse.name))
    && params.options.some(option => option.value === ToolConfirmationOutcome.ProceedOnce);
}

/** Session-local localhost server, never persisted in the user's MCP settings. */
export async function createBtwAnalysisTools(cwd: string): Promise<BtwAnalysisTools> {
  // Droid truncates MCP server identifiers at 32 characters.
  const name = `btw-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const runner = new BtwAnalysisRunner();
  let closed = false;
  let controller = new AbortController();
  const guarded = async (run: () => Promise<unknown>) => {
    try {
      if (closed) throw new Error('This side conversation is closed.');
      return { content: [{ type: 'text' as const, text: JSON.stringify(await run()) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) }] };
    }
  };
  const server = createSdkMcpServer({ name, tools: [
    tool('run_javascript',
      'Validate a standalone JavaScript/TypeScript example with console.log, assert and return. '
      + 'Isolated WASM: no filesystem, network, subprocesses, imports or timers. Promise microtasks work. '
      + 'Optional project-relative snapshot paths become read-only strings in files[path]. '
      + 'TypeScript is transpiled, not typechecked. Does not run project tests. Limits: 2s guest CPU deadline, 32MiB guest memory, 16k output.',
      { code: z.string().min(1).max(32_000), language: z.enum(['javascript', 'typescript']).default('javascript'),
        snapshotPaths: z.array(z.string().min(1).max(512)).max(8).default([]) },
      async ({ code, language, snapshotPaths }) => guarded(async () => {
        const signal = controller.signal;
        const files = await readBtwSnapshots(cwd, snapshotPaths);
        signal.throwIfAborted();
        return runner.run({ code, language, files });
      })),
    tool('git_query', 'Read current Git status, unstaged diff, staged diff or the latest 20 commit subjects. No arbitrary commands or Git mutations.',
      { query: z.enum(['status', 'diff', 'staged_diff', 'log']) },
      async ({ query }) => guarded(() => queryBtwGit(cwd, query, controller.signal))),
  ] });
  try {
    // The SDK's older protocol gate rejects even oauth:false on newer CLI peers.
    // This local server uses its generated bearer header, with no OAuth flow.
    const { oauth: _oauth, ...config } = await server.start();
    const cancel = () => { controller.abort(); controller = new AbortController(); runner.cancel(); };
    return {
      mcpServers: [config],
      toolIds: new Set(['run_javascript', 'git_query'].map(toolName => `${name}___${toolName}`)),
      cancel,
      async close() { closed = true; cancel(); await server.close(); },
    };
  } catch (error) { await server.close(); throw error; }
}
