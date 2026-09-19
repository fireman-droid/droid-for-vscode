import type { DaemonApi } from './api';
import { describe, expect, it, vi } from 'vitest';

import {
  DAEMON_ARCHIVED_LIST_LIMIT,
  DAEMON_LIST_FETCH_LIMIT,
  DAEMON_SEARCH_SESSION_LIMIT,
  DAEMON_SEARCH_SNIPPET_LIMIT,
  DaemonSessionCatalog,
} from './DaemonSessionCatalog';

const CWD = 'D:\\workspace\\project';

function droidWith(sessions: Record<string, unknown>): DaemonApi {
  return { sessions } as unknown as DaemonApi;
}

describe('DaemonSessionCatalog', () => {
  it('delegates archive and reports daemon success', async () => {
    const archive = vi.fn(async () => ({
      success: true,
      archivedAt: '2026-08-11T00:00:00.000Z',
    }));
    const catalog = new DaemonSessionCatalog(droidWith({ archive }));

    await expect(catalog.archive('session-1')).resolves.toBe(true);
    expect(archive).toHaveBeenCalledWith('session-1');
  });

  it('delegates unarchive and reports daemon failure', async () => {
    const unarchive = vi.fn(async () => ({ success: false }));
    const catalog = new DaemonSessionCatalog(droidWith({ unarchive }));

    await expect(catalog.unarchive('session-1')).resolves.toBe(false);
    expect(unarchive).toHaveBeenCalledWith('session-1');
  });

  it('lists only archived rows of the workspace as ISO projections', async () => {
    const modified = new Date('2026-08-09T12:00:00.000Z');
    const archived = new Date('2026-08-10T09:30:00.000Z');
    const list = vi.fn(async () => [
      // Not archived: skipped.
      { id: 'live-1', title: 'Live', messageCount: 1, modifiedTime: modified, cwd: CWD },
      // Other workspace: skipped.
      {
        id: 'other-1',
        title: 'Elsewhere',
        messageCount: 1,
        modifiedTime: modified,
        archivedTime: archived,
        cwd: 'D:\\workspace\\other',
      },
      // Unsafe id: skipped.
      {
        id: ' bad-id',
        title: 'Bad id',
        messageCount: 1,
        modifiedTime: modified,
        archivedTime: archived,
        cwd: CWD,
      },
      // Matches by repoRoot with different path casing.
      {
        id: 'repo-1',
        title: '  Archived\u0000 investigation ',
        messageCount: 3,
        modifiedTime: modified,
        archivedTime: archived,
        repoRoot: 'd:\\WORKSPACE\\project',
      },
      // Missing title falls back to a readable placeholder.
      {
        id: 'untitled-1',
        messageCount: 0,
        modifiedTime: modified,
        archivedTime: archived,
        cwd: CWD,
      },
    ]);
    const catalog = new DaemonSessionCatalog(droidWith({ list }));

    await expect(catalog.listArchived(CWD)).resolves.toEqual([
      {
        id: 'repo-1',
        title: 'Archived investigation',
        modifiedTime: '2026-08-09T12:00:00.000Z',
        archivedTime: '2026-08-10T09:30:00.000Z',
      },
      {
        id: 'untitled-1',
        title: 'Untitled session',
        modifiedTime: '2026-08-09T12:00:00.000Z',
        archivedTime: '2026-08-10T09:30:00.000Z',
      },
    ]);
    expect(list).toHaveBeenCalledWith({
      includeArchived: true,
      limit: DAEMON_LIST_FETCH_LIMIT,
    });
  });

  it('keeps the fetch limit within the daemon schema cap', () => {
    // The daemon client's Zod schema rejects `limit > 100` before the
    // request is sent; a 200-row fetch made every listArchived call
    // fail with a ZodError (field logs: repeated archived-load-failed
    // on v0.1.1). Guard the cap so the archived drawer never goes
    // silently dark again.
    expect(DAEMON_LIST_FETCH_LIMIT).toBeLessThanOrEqual(100);
    // The workspace filter needs headroom over the projected cap.
    expect(DAEMON_LIST_FETCH_LIMIT).toBeGreaterThanOrEqual(DAEMON_ARCHIVED_LIST_LIMIT);
  });

  it('caps the archived projection', async () => {
    const rows = Array.from({ length: DAEMON_ARCHIVED_LIST_LIMIT + 5 }, (_, index) => ({
      id: `archived-${index}`,
      title: `Archived ${index}`,
      messageCount: 0,
      modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
      archivedTime: new Date('2026-08-10T09:30:00.000Z'),
      cwd: CWD,
    }));
    const catalog = new DaemonSessionCatalog(droidWith({ list: async () => rows }));

    await expect(catalog.listArchived(CWD)).resolves.toHaveLength(
      DAEMON_ARCHIVED_LIST_LIMIT,
    );
  });

  it('filters Task and Mission workers by daemon metadata only', async () => {
    const modifiedTime = new Date('2026-08-09T12:00:00.000Z');
    const archivedTime = new Date('2026-08-10T09:30:00.000Z');
    const row = {
      title: 'Task: title text is not identity',
      messageCount: 0,
      modifiedTime,
      archivedTime,
      cwd: CWD,
    };
    const catalog = new DaemonSessionCatalog(
      droidWith({
        list: async () => [
          { ...row, id: 'ordinary' },
          { ...row, id: 'task-child', parentSessionId: 'parent' },
          { ...row, id: 'tool-child', parentToolUseId: 'tool' },
          {
            ...row,
            id: 'tagged-child',
            tags: [{ name: 'subagent' }],
          },
          {
            ...row,
            id: 'mission-worker',
            tags: [
              {
                name: 'decompSessionType',
                metadata: { value: 'worker' },
              },
            ],
          },
          {
            ...row,
            id: 'mission-orchestrator',
            tags: [
              {
                name: 'decompSessionType',
                metadata: { value: 'orchestrator' },
              },
            ],
          },
          // Agent-team `droid exec` runs belong to the team panel,
          // never the drawer or the archived list.
          {
            ...row,
            id: 'exec-team',
            tags: [{ name: 'exec' }],
          },
        ],
      }),
    );

    await expect(catalog.listArchived(CWD)).resolves.toEqual([
      expect.objectContaining({ id: 'ordinary' }),
      expect.objectContaining({ id: 'mission-orchestrator' }),
    ]);
  });

  it('maps opened working states by safe session id', async () => {
    const listOpened = vi.fn(async () => [
      { id: 'running-1', workingState: 'working' },
      { id: 'idle-1', workingState: 'idle' },
      { id: ' bad id', workingState: 'working' },
    ]);
    const catalog = new DaemonSessionCatalog(droidWith({ listOpened }));

    const states = await catalog.readOpenedWorkingStates();

    expect(states.get('running-1')).toBe('working');
    expect(states.get('idle-1')).toBe('idle');
    // Unsafe ids never enter the map; sessions the daemon does not
    // list as open are simply absent.
    expect(states.size).toBe(2);
  });

  it('projects bounded single-line search matches', async () => {
    const search = vi.fn(async () => ({
      query: 'refactor',
      sessions: [
        {
          id: 'hit-1',
          title: '  Refactor\u0000 store ',
          modifiedTime: new Date('2026-08-09T12:00:00.000Z'),
          hits: [{ snippets: ['', `line\r\none ${'x'.repeat(400)}`] }],
        },
        {
          id: 'hit-2',
          hits: [],
        },
        {
          id: ' bad id',
          hits: [],
        },
      ],
    }));
    const catalog = new DaemonSessionCatalog(droidWith({ search }));

    const matches = await catalog.search('refactor');

    expect(search).toHaveBeenCalledWith({
      query: 'refactor',
      limitSessions: DAEMON_SEARCH_SESSION_LIMIT,
      limitHitsPerSession: 1,
      contextChars: DAEMON_SEARCH_SNIPPET_LIMIT,
    });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      id: 'hit-1',
      title: 'Refactor store',
      modifiedTime: '2026-08-09T12:00:00.000Z',
    });
    expect(matches[0]?.snippet?.startsWith('line one')).toBe(true);
    expect(matches[0]?.snippet?.length).toBeLessThanOrEqual(DAEMON_SEARCH_SNIPPET_LIMIT);
    expect(matches[0]?.snippet).not.toMatch(/[\r\n]/);
    expect(matches[1]).toEqual({
      id: 'hit-2',
      title: 'Untitled session',
      modifiedTime: null,
      snippet: null,
    });
  });

  it('caps search matches at the session limit', async () => {
    const rows = Array.from({ length: DAEMON_SEARCH_SESSION_LIMIT + 5 }, (_, index) => ({
      id: `hit-${index}`,
      hits: [],
    }));
    const catalog = new DaemonSessionCatalog(
      droidWith({ search: async () => ({ query: 'q', sessions: rows }) }),
    );

    await expect(catalog.search('q')).resolves.toHaveLength(DAEMON_SEARCH_SESSION_LIMIT);
  });
});
