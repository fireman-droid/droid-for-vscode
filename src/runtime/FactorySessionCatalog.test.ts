import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FACTORY_SESSION_CATALOG_LIMIT,
  FactorySessionCatalog,
  readWorkerSessionIds,
} from './FactorySessionCatalog';
import {
  MAX_SESSION_CATALOG_ID_LENGTH,
  MAX_SESSION_CATALOG_TITLE_LENGTH,
} from './SessionCatalog';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('FactorySessionCatalog', () => {
  it('lists only the bounded public SDK projection for a cwd', async () => {
    const modifiedTime = new Date('2026-08-09T12:00:00.000Z');
    const createdTime = new Date('2026-08-08T12:00:00.000Z');
    const listSdkSessions = vi.fn(async () => [
      {
        id: 'session-1',
        title: '  Review\u0000\r\n authentication   flow  ',
        owner: 'must not escape',
        messageCount: 7,
        modifiedTime,
        createdTime,
        isFavorite: true,
        cwd: 'C:\\workspace',
        privateValue: 'must not escape',
      },
    ]);
    const catalog = new FactorySessionCatalog({ listSdkSessions });

    await expect(catalog.listSessions('C:\\workspace')).resolves.toEqual({
      status: 'available',
      sessions: [
        {
          id: 'session-1',
          title: 'Review authentication flow',
          messageCount: 7,
          modifiedTime: '2026-08-09T12:00:00.000Z',
          createdTime: '2026-08-08T12:00:00.000Z',
          isFavorite: true,
        },
      ],
    });
    expect(listSdkSessions).toHaveBeenCalledOnce();
    expect(listSdkSessions).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      limit: 50,
    });
  });

  it('bounds titles and the projected result count', async () => {
    const metadata = Array.from(
      { length: FACTORY_SESSION_CATALOG_LIMIT + 10 },
      (_, index) => ({
        id: `session-${index}`,
        title: 'x'.repeat(MAX_SESSION_CATALOG_TITLE_LENGTH + 20),
        messageCount: index,
        modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
        createdTime: new Date('2026-08-08T12:00:00.000Z'),
      }),
    );
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => metadata,
    });

    const result = await catalog.listSessions('C:\\workspace');

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      throw new Error('Expected an available catalog.');
    }
    expect(result.sessions).toHaveLength(FACTORY_SESSION_CATALOG_LIMIT);
    expect(result.sessions[0]?.title).toHaveLength(
      MAX_SESSION_CATALOG_TITLE_LENGTH,
    );
  });

  it('drops malformed metadata without changing session identities', async () => {
    const valid = {
      id: 'valid-session',
      title: 'Valid title',
      messageCount: 0,
      modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
      createdTime: new Date('2026-08-08T12:00:00.000Z'),
    };
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [
        { ...valid, id: ` ${valid.id}` },
        { ...valid, id: 'x'.repeat(MAX_SESSION_CATALOG_ID_LENGTH + 1) },
        { ...valid, id: 'untitled-session', title: '\u0000\r\n' },
        { ...valid, messageCount: -1 },
        { ...valid, modifiedTime: new Date(Number.NaN) },
        valid,
      ],
    });

    await expect(catalog.listSessions('C:\\workspace')).resolves.toEqual({
      status: 'available',
      sessions: [
        {
          id: 'untitled-session',
          title: 'Untitled session',
          messageCount: 0,
          modifiedTime: '2026-08-09T12:00:00.000Z',
          createdTime: '2026-08-08T12:00:00.000Z',
          isFavorite: false,
        },
        {
          id: 'valid-session',
          title: 'Valid title',
          messageCount: 0,
          modifiedTime: '2026-08-09T12:00:00.000Z',
          createdTime: '2026-08-08T12:00:00.000Z',
          isFavorite: false,
        },
      ],
    });
  });

  it('filters mission workers while keeping orchestrators and ordinary sessions', async () => {
    const base = {
      title: 'Session',
      messageCount: 0,
      modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
      createdTime: new Date('2026-08-08T12:00:00.000Z'),
    };
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [
        { ...base, id: 'orchestrator-session', decompSessionType: 'orchestrator' },
        { ...base, id: 'worker-session', decompSessionType: 'worker' },
        { ...base, id: 'plain-session' },
        { ...base, id: 'odd-session', decompSessionType: 'supervisor' },
      ],
    });

    const result = await catalog.listSessions('C:\\workspace');

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      throw new Error('Expected an available catalog.');
    }
    expect(
      result.sessions.map(({ id, missionRole }) => ({ id, missionRole })),
    ).toEqual([
      { id: 'orchestrator-session', missionRole: 'orchestrator' },
      { id: 'plain-session', missionRole: undefined },
      { id: 'odd-session', missionRole: undefined },
    ]);
    expect('missionRole' in result.sessions[1]!).toBe(false);
    expect('missionRole' in result.sessions[2]!).toBe(false);
  });

  it('filters only ids marked by authoritative worker metadata', async () => {
    const base = {
      title: 'Session',
      messageCount: 0,
      modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
      createdTime: new Date('2026-08-08T12:00:00.000Z'),
    };
    const readWorkerSessionIds = vi.fn(async () =>
      new Set(['task-child']),
    );
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [
        { ...base, id: 'ordinary-session' },
        { ...base, id: 'task-child' },
      ],
      sessionsDirectory: 'D:\\fake\\sessions',
      readWorkerSessionIds,
    });

    const result = await catalog.listSessions('D:\\workspace');

    expect(result).toMatchObject({
      status: 'available',
      sessions: [{ id: 'ordinary-session' }],
    });
    expect(readWorkerSessionIds).toHaveBeenCalledWith({
      sessionsDirectory: 'D:\\fake\\sessions',
      cwd: 'D:\\workspace',
      sessionIds: ['ordinary-session', 'task-child'],
    });
  });

  it('fails open when worker metadata cannot be read', async () => {
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [
        {
          id: 'ordinary-session',
          title: 'Task: keep this user title',
          messageCount: 0,
          modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
          createdTime: new Date('2026-08-08T12:00:00.000Z'),
        },
      ],
      readWorkerSessionIds: async () => {
        throw new Error('settings unavailable');
      },
    });

    await expect(catalog.listSessions('D:\\workspace')).resolves.toMatchObject({
      status: 'available',
      sessions: [{ id: 'ordinary-session', title: 'Task: keep this user title' }],
    });
  });

  it('delegates favorite writes to the sessions directory writer', async () => {
    const writeFavoriteFile = vi.fn(async () => true);
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [],
      sessionsDirectory: 'D:\\fake\\sessions',
      writeFavoriteFile,
    });

    await expect(
      catalog.writeFavorite('session-1', true),
    ).resolves.toBe(true);
    expect(writeFavoriteFile).toHaveBeenCalledOnce();
    expect(writeFavoriteFile).toHaveBeenCalledWith(
      'D:\\fake\\sessions',
      'session-1',
      true,
    );
  });

  it('reports false when the favorites writer throws', async () => {
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => [],
      sessionsDirectory: 'D:\\fake\\sessions',
      writeFavoriteFile: async () => {
        throw new Error('EACCES: C:\\Users\\person\\.factory');
      },
    });

    await expect(
      catalog.writeFavorite('session-1', false),
    ).resolves.toBe(false);
  });

  it('returns a generic failure without exposing SDK errors', async () => {
    const catalog = new FactorySessionCatalog({
      listSdkSessions: async () => {
        throw new Error('C:\\Users\\person\\.factory\\sensitive.jsonl');
      },
    });

    const result = await catalog.listSessions('C:\\workspace');

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'catalog-failed',
      message: 'Saved Droid sessions could not be loaded.',
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(JSON.stringify(result)).not.toContain('.jsonl');
  });
});

describe('readWorkerSessionIds', () => {
  it('reads subagent and Mission worker tags from settings sidecars', async () => {
    const sessionsDirectory = await createTemporarySessionsDirectory();
    const cwd = path.join(sessionsDirectory, 'workspace');
    await mkdir(cwd);
    const workspaceDirectory = path.join(
      sessionsDirectory,
      encodedWorkspaceDirectory(cwd),
    );
    await mkdir(workspaceDirectory);
    await Promise.all([
      writeSettings(workspaceDirectory, 'ordinary', {
        tags: [{ name: 'project:user-session' }],
      }),
      writeSettings(workspaceDirectory, 'task-child', {
        tags: [
          {
            name: 'subagent',
            metadata: {
              callingSessionId: 'parent',
              callingToolUseId: 'tool',
            },
          },
        ],
      }),
      writeSettings(workspaceDirectory, 'mission-worker', {
        tags: [
          {
            name: 'decompSessionType',
            metadata: { value: 'worker' },
          },
        ],
      }),
      writeSettings(workspaceDirectory, 'mission-orchestrator', {
        tags: [
          {
            name: 'decompSessionType',
            metadata: { value: 'orchestrator' },
          },
        ],
      }),
      // Agent-team `droid exec` runs stay out of the drawer: resuming
      // one would double-write against the external CLI process.
      writeSettings(workspaceDirectory, 'exec-team', {
        tags: [{ name: 'exec' }],
      }),
    ]);

    await expect(
      readWorkerSessionIds({
        sessionsDirectory,
        cwd,
        sessionIds: [
          'ordinary',
          'task-child',
          'mission-worker',
          'mission-orchestrator',
          'exec-team',
        ],
      }),
    ).resolves.toEqual(
      new Set(['task-child', 'mission-worker', 'exec-team']),
    );
  });

  it('ignores malformed, oversized, missing, and path-like sidecars', async () => {
    const sessionsDirectory = await createTemporarySessionsDirectory();
    const cwd = path.join(sessionsDirectory, 'workspace');
    await mkdir(cwd);
    const workspaceDirectory = path.join(
      sessionsDirectory,
      encodedWorkspaceDirectory(cwd),
    );
    await mkdir(workspaceDirectory);
    await Promise.all([
      writeFile(
        path.join(workspaceDirectory, 'malformed.settings.json'),
        '{',
        'utf8',
      ),
      writeSettings(workspaceDirectory, 'oversized', {
        padding: 'x'.repeat(70 * 1024),
        tags: [{ name: 'subagent' }],
      }),
    ]);

    await expect(
      readWorkerSessionIds({
        sessionsDirectory,
        cwd,
        sessionIds: ['malformed', 'oversized', 'missing', '../escape'],
      }),
    ).resolves.toEqual(new Set());
  });
});

async function createTemporarySessionsDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'droidvisx-catalog-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function encodedWorkspaceDirectory(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? `-${normalized
        .replace(/^([A-Z]):/i, '$1')
        .replace(/[\\/]+/g, '-')}`
    : `-${normalized.replace(/^\/+/, '').replace(/\/+/g, '-')}`;
}

async function writeSettings(
  directory: string,
  sessionId: string,
  value: unknown,
): Promise<void> {
  await writeFile(
    path.join(directory, `${sessionId}.settings.json`),
    JSON.stringify(value),
    'utf8',
  );
}
