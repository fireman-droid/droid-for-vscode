import { DroidClient, ProcessTransport } from '@factory/droid-sdk/node';

import { type ToolSubagentSummary } from '../../shared/protocol/transcript';
import type { RuntimeDiagnosticSink } from '../runtimeDiagnostics';
import {
  readSubagentInvocationRecords,
  readSubagentInvocations,
  type SubagentInvocationRecord,
} from '../subagents/subagentSummary';
import {
  type SessionHistoryLoader,
  type SessionHistoryResult,
  unavailableSessionHistory,
} from './SessionHistory';
import { projectSessionHistory } from './projectSessionHistory';

export interface FactoryHistoryClient {
  loadSession(params: { sessionId: string }): Promise<unknown>;
  close(): Promise<void>;
}

export type FactoryHistoryClientFactory = (cwd: string) => Promise<FactoryHistoryClient>;

export interface FactorySessionHistoryLoaderOptions {
  readonly createClient?: FactoryHistoryClientFactory;
  readonly diagnostics?: RuntimeDiagnosticSink;
}

export class FactorySessionHistoryLoader implements SessionHistoryLoader {
  private readonly createClient: FactoryHistoryClientFactory;
  private readonly diagnostics: RuntimeDiagnosticSink | undefined;

  constructor(options: FactorySessionHistoryLoaderOptions = {}) {
    this.createClient = options.createClient ?? createLocalHistoryClient;
    this.diagnostics = options.diagnostics;
  }

  async loadHistory({
    cwd,
    sessionId,
  }: {
    readonly cwd: string;
    readonly sessionId: string;
  }): Promise<SessionHistoryResult> {
    const loaded = await this.loadSessionEnvelope(cwd, sessionId);
    if (loaded === LOAD_FAILED) {
      return unavailableSessionHistory();
    }
    return projectSessionHistory(loaded, {
      workspaceRoot: cwd,
      sourceSessionId: sessionId,
    });
  }

  async loadSubagentSummaries({
    cwd,
    sessionId,
  }: {
    readonly cwd: string;
    readonly sessionId: string;
  }): Promise<readonly ToolSubagentSummary[] | null> {
    const loaded = await this.loadSessionEnvelope(cwd, sessionId);
    if (loaded === LOAD_FAILED) {
      return null;
    }
    return readSubagentInvocations(loaded);
  }

  async loadSubagentInvocations({
    cwd,
    sessionId,
  }: {
    readonly cwd: string;
    readonly sessionId: string;
  }): Promise<readonly SubagentInvocationRecord[] | null> {
    const loaded = await this.loadSessionEnvelope(cwd, sessionId);
    if (loaded === LOAD_FAILED) {
      return null;
    }
    return readSubagentInvocationRecords(loaded);
  }

  private async loadSessionEnvelope(cwd: string, sessionId: string): Promise<unknown> {
    // Each load spawns (and tears down) its own droid CLI process; the
    // spawn cost dominates session-switch latency, so it gets its own
    // timing record next to `runtime.history.finished`.
    const spawnStart = performance.now();
    let client: FactoryHistoryClient | null = null;
    try {
      client = await this.createClient(cwd);
      this.recordSpawn(spawnStart, 'ok', sessionId);
      const loaded: unknown = await client.loadSession({ sessionId });
      const loadedClient = client;
      client = null;
      await loadedClient.close();
      return loaded;
    } catch (error) {
      if (client) {
        await client.close().catch(() => undefined);
      } else {
        this.recordSpawn(spawnStart, 'failed', sessionId, error);
      }
      return LOAD_FAILED;
    }
  }

  private recordSpawn(
    startedAt: number,
    outcome: 'ok' | 'failed',
    sessionId: string,
    error?: unknown,
  ): void {
    try {
      this.diagnostics?.record({
        level: outcome === 'ok' ? 'info' : 'warn',
        name: 'runtime.history.spawn',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome,
          sessionId,
        },
        ...(error === undefined
          ? {}
          : {
              detail:
                error instanceof Error ? (error.stack ?? error.message) : String(error),
            }),
      });
    } catch {
      // Diagnostics must never alter history loading behavior.
    }
  }
}

/** Sentinel distinguishing a failed load from any loaded payload. */
const LOAD_FAILED = Symbol('load-failed');

async function createLocalHistoryClient(cwd: string): Promise<FactoryHistoryClient> {
  const transport = new ProcessTransport({ cwd });
  try {
    await transport.connect();
    return new DroidClient({ transport });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}
