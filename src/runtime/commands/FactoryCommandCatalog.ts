import { DroidClient, ProcessTransport } from '@factory/droid-sdk/node';

import { isSafeCommandName } from '../../shared/validateMessage';
import {
  MAX_RUNTIME_COMMAND_ARGUMENT_HINT_LENGTH,
  MAX_RUNTIME_COMMAND_DESCRIPTION_LENGTH,
  MAX_RUNTIME_COMMAND_ITEMS,
  type RuntimeCommand,
} from '../DroidRuntime';

/**
 * Minimal public-API surface used to list custom slash commands. The
 * high-level SDK session does not expose `listCommands`, so the
 * catalog opens a short-lived `DroidClient` over its own
 * `ProcessTransport` — the same public channel the session history
 * loader uses — loads the active session read-only, and queries the
 * command list.
 */
export interface FactoryCommandsClient {
  loadSession(params: { sessionId: string }): Promise<unknown>;
  listCommands(): Promise<unknown>;
  close(): Promise<void>;
}

export type FactoryCommandsClientFactory = (
  cwd: string,
) => Promise<FactoryCommandsClient>;

export async function loadSessionCommands(options: {
  readonly cwd: string;
  readonly sessionId: string;
  readonly createClient?: FactoryCommandsClientFactory;
}): Promise<readonly RuntimeCommand[]> {
  const createClient = options.createClient ?? createLocalCommandsClient;
  let client: FactoryCommandsClient | null = null;
  try {
    client = await createClient(options.cwd);
    await client.loadSession({ sessionId: options.sessionId });
    const response = await client.listCommands();
    return projectCommandList(response);
  } finally {
    if (client !== null) {
      await client.close().catch(() => undefined);
    }
  }
}

async function createLocalCommandsClient(
  cwd: string,
): Promise<FactoryCommandsClient> {
  const transport = new ProcessTransport({ cwd });
  try {
    await transport.connect();
    return new DroidClient({ transport });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function projectCommandList(
  response: unknown,
): readonly RuntimeCommand[] {
  if (!isRecord(response) || !isRecord(response.result)) {
    throw new Error('Droid returned an invalid command list.');
  }
  const rawCommands = response.result.commands;
  if (!Array.isArray(rawCommands)) {
    throw new Error('Droid returned an invalid command list.');
  }

  const commands: RuntimeCommand[] = [];
  const seen = new Set<string>();
  for (const raw of rawCommands) {
    if (commands.length >= MAX_RUNTIME_COMMAND_ITEMS) {
      break;
    }
    const command = projectCommand(raw);
    if (command !== null && !seen.has(command.name)) {
      seen.add(command.name);
      commands.push(command);
    }
  }
  return commands;
}

/**
 * Projects one raw SDK command record to safe display fields. Records
 * without a usable slug are dropped; oversized descriptive text is
 * truncated rather than dropping the command.
 */
function projectCommand(raw: unknown): RuntimeCommand | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = raw.name;
  if (!isSafeCommandName(name)) {
    return null;
  }
  return {
    name,
    description: projectText(
      raw.description,
      MAX_RUNTIME_COMMAND_DESCRIPTION_LENGTH,
    ),
    argumentHint: projectText(
      raw.argumentHint,
      MAX_RUNTIME_COMMAND_ARGUMENT_HINT_LENGTH,
    ),
    isExecutable: raw.isExecutable === true,
  };
}

function projectText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const flattened = value.replace(/\s+/g, ' ').trim();
  if (
    flattened.length === 0 ||
    /[\u0000-\u001f\u007f]/.test(flattened)
  ) {
    return null;
  }
  return flattened.length > maximumLength
    ? flattened.slice(0, maximumLength)
    : flattened;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
