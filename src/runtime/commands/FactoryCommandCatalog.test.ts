import { describe, expect, it, vi } from 'vitest';

import {
  loadSessionCommands,
  type FactoryCommandsClient,
} from './FactoryCommandCatalog';

interface MockCommandsClient extends FactoryCommandsClient {
  loadSession: ReturnType<typeof vi.fn<FactoryCommandsClient['loadSession']>>;
  listCommands: ReturnType<typeof vi.fn<FactoryCommandsClient['listCommands']>>;
  close: ReturnType<typeof vi.fn<FactoryCommandsClient['close']>>;
}

function createClient(response: unknown): MockCommandsClient {
  return {
    loadSession: vi.fn<FactoryCommandsClient['loadSession']>(
      async () => ({}),
    ),
    listCommands: vi.fn<FactoryCommandsClient['listCommands']>(
      async () => response,
    ),
    close: vi.fn<FactoryCommandsClient['close']>(async () => undefined),
  };
}

function commandsResponse(commands: readonly unknown[]): unknown {
  return { result: { commands } };
}

describe('loadSessionCommands', () => {
  it('loads the session then projects the command list', async () => {
    const client = createClient(
      commandsResponse([
        {
          name: 'deploy',
          description: 'Deploys the branch.',
          argumentHint: '<env>',
          isExecutable: false,
        },
        { name: 'triage', isExecutable: true },
      ]),
    );

    const commands = await loadSessionCommands({
      cwd: 'C:/work',
      sessionId: 'session-1',
      createClient: async () => client,
    });

    expect(client.loadSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
    });
    expect(commands).toEqual([
      {
        name: 'deploy',
        description: 'Deploys the branch.',
        argumentHint: '<env>',
        isExecutable: false,
      },
      {
        name: 'triage',
        description: null,
        argumentHint: null,
        isExecutable: true,
      },
    ]);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('drops records with unusable names and duplicate slugs', async () => {
    const client = createClient(
      commandsResponse([
        { name: 'ok' },
        { name: 'bad name' },
        { name: 'has/slash' },
        { name: '' },
        { name: 42 },
        'not-a-record',
        { name: 'ok', description: 'duplicate' },
      ]),
    );

    const commands = await loadSessionCommands({
      cwd: 'C:/work',
      sessionId: 'session-1',
      createClient: async () => client,
    });

    expect(commands.map((command) => command.name)).toEqual(['ok']);
    expect(commands[0]!.description).toBeNull();
  });

  it('flattens and truncates oversized descriptive text', async () => {
    const client = createClient(
      commandsResponse([
        {
          name: 'long',
          description: `a  b\n${'c'.repeat(600)}`,
          argumentHint: ' \n ',
        },
      ]),
    );

    const [command] = await loadSessionCommands({
      cwd: 'C:/work',
      sessionId: 'session-1',
      createClient: async () => client,
    });

    expect(command!.description!.startsWith('a b c')).toBe(true);
    expect(command!.description!.length).toBe(512);
    expect(command!.argumentHint).toBeNull();
  });

  it('caps the projected list at the runtime item limit', async () => {
    const client = createClient(
      commandsResponse(
        Array.from({ length: 250 }, (_, index) => ({
          name: `command-${index}`,
        })),
      ),
    );

    const commands = await loadSessionCommands({
      cwd: 'C:/work',
      sessionId: 'session-1',
      createClient: async () => client,
    });

    expect(commands).toHaveLength(200);
  });

  it('rejects responses without a command array', async () => {
    const client = createClient({ result: { commands: 'nope' } });

    await expect(
      loadSessionCommands({
        cwd: 'C:/work',
        sessionId: 'session-1',
        createClient: async () => client,
      }),
    ).rejects.toThrow('invalid command list');
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('closes the client when loadSession fails', async () => {
    const client = createClient(commandsResponse([]));
    client.loadSession.mockRejectedValue(new Error('no session'));

    await expect(
      loadSessionCommands({
        cwd: 'C:/work',
        sessionId: 'session-1',
        createClient: async () => client,
      }),
    ).rejects.toThrow('no session');
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
