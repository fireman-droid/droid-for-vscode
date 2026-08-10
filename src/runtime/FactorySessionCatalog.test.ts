import { describe, expect, it, vi } from 'vitest';

import {
  FACTORY_SESSION_CATALOG_LIMIT,
  FactorySessionCatalog,
} from './FactorySessionCatalog';
import {
  MAX_SESSION_CATALOG_ID_LENGTH,
  MAX_SESSION_CATALOG_TITLE_LENGTH,
} from './SessionCatalog';

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
