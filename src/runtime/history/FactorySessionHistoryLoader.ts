import {
  DroidClient,
  ProcessTransport,
} from '@factory/droid-sdk/node';

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
    let client: FactoryHistoryClient | null = null;
    let loaded: unknown;
    try {
      client = await this.createClient(cwd);
      loaded = await client.loadSession({ sessionId });
      const loadedClient = client;
      client = null;
      await loadedClient.close();
    } catch {
      if (client) {
        await client.close().catch(() => undefined);
      }
      return unavailableSessionHistory();
    }

    return projectSessionHistory(loaded, { workspaceRoot: cwd });
  }
}

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
