import {
  DroidClient,
  ProcessTransport,
} from '@factory/droid-sdk/node';

import type { ToolSubagentSummary } from '../../shared/bridgeMessages';
import { readSubagentInvocations } from '../subagentSummary';
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

export type FactoryHistoryClientFactory = (
  cwd: string,
) => Promise<FactoryHistoryClient>;

export interface FactorySessionHistoryLoaderOptions {
  readonly createClient?: FactoryHistoryClientFactory;
}

export class FactorySessionHistoryLoader
  implements SessionHistoryLoader
{
  private readonly createClient: FactoryHistoryClientFactory;

  constructor(options: FactorySessionHistoryLoaderOptions = {}) {
    this.createClient = options.createClient ?? createLocalHistoryClient;
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
    return projectSessionHistory(loaded, { workspaceRoot: cwd });
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

  private async loadSessionEnvelope(
    cwd: string,
    sessionId: string,
  ): Promise<unknown> {
    let client: FactoryHistoryClient | null = null;
    try {
      client = await this.createClient(cwd);
      const loaded: unknown = await client.loadSession({ sessionId });
      const loadedClient = client;
      client = null;
      await loadedClient.close();
      return loaded;
    } catch {
      if (client) {
        await client.close().catch(() => undefined);
      }
      return LOAD_FAILED;
    }
  }
}

/** Sentinel distinguishing a failed load from any loaded payload. */
const LOAD_FAILED = Symbol('load-failed');

async function createLocalHistoryClient(
  cwd: string,
): Promise<FactoryHistoryClient> {
  const transport = new ProcessTransport({ cwd });
  try {
    await transport.connect();
    return new DroidClient({ transport });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}
