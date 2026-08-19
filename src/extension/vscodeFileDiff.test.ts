import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangeStatsReader } from './changeStats';
import { createVscodeFileDiffOpener } from './vscodeFileDiff';

interface MockUri {
  readonly scheme: string;
  readonly path: string;
  readonly fsPath: string;
  readonly query: string;
  with(change: { scheme?: string; query?: string }): MockUri;
}

const mocks = vi.hoisted(() => ({
  provider: null as {
    provideTextDocumentContent(uri: MockUri): string | undefined;
  } | null,
  providerDispose: vi.fn(),
  closeListener: null as ((document: { uri: MockUri }) => void) | null,
  closeListenerDispose: vi.fn(),
  stat: vi.fn(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  getExtension: vi.fn(),
  recordDiagnostic: vi.fn(),
}));

vi.mock('vscode', () => {
  const makeUri = (
    scheme: string,
    path: string,
    fsPath = path,
    query = '',
  ): MockUri => ({
    scheme,
    path,
    fsPath,
    query,
    with(change) {
      return makeUri(
        change.scheme ?? scheme,
        path,
        fsPath,
        change.query ?? query,
      );
    },
  });
  return {
    workspace: {
      workspaceFolders: [
        { uri: makeUri('file', '/workspace', 'C:\\workspace') },
      ],
      fs: { stat: mocks.stat },
      registerTextDocumentContentProvider: (
        _scheme: string,
        provider: NonNullable<typeof mocks.provider>,
      ) => {
        mocks.provider = provider;
        return { dispose: mocks.providerDispose };
      },
      onDidCloseTextDocument: (
        listener: (document: { uri: MockUri }) => void,
      ) => {
        mocks.closeListener = listener;
        return { dispose: mocks.closeListenerDispose };
      },
    },
    Uri: {
      file: (path: string) => makeUri('file', path, path),
      from: ({
        scheme,
        path,
        query,
      }: {
        scheme: string;
        path: string;
        query?: string;
      }) => makeUri(scheme, path, path, query),
    },
    commands: { executeCommand: mocks.executeCommand },
    window: { showTextDocument: mocks.showTextDocument },
    extensions: { getExtension: mocks.getExtension },
  };
});

function reader(
  baseline: string | undefined,
): ChangeStatsReader {
  return {
    read: async () => new Map(),
    readTurnBaseline: vi.fn(async () => baseline),
  };
}

const diagnostics = {
  record: mocks.recordDiagnostic,
};

describe('createVscodeFileDiffOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider = null;
    mocks.closeListener = null;
    mocks.stat.mockResolvedValue({});
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.showTextDocument.mockResolvedValue(undefined);
    mocks.getExtension.mockReturnValue(undefined);
  });

  it('opens a captured before-turn document outside git', async () => {
    const changeStats = reader('before\n');
    const opener = createVscodeFileDiffOpener(
      changeStats,
      diagnostics,
    );
    const scope = { sessionId: 'session-a', turnId: 'turn-a' };

    await expect(opener.openDiff('index.html', scope)).resolves.toBe(
      'opened-diff',
    );

    expect(changeStats.readTurnBaseline).toHaveBeenCalledWith(
      scope,
      'index.html',
    );
    const [, baselineUri, fileUri, title] =
      mocks.executeCommand.mock.calls[0] ?? [];
    expect(baselineUri).toMatchObject({
      scheme: 'droidvisx-turn-baseline',
      query: '1',
    });
    expect((baselineUri as MockUri).path).toMatch(/index\.html$/);
    expect(fileUri).toMatchObject({
      scheme: 'file',
      fsPath: 'C:\\workspace\\index.html',
    });
    expect(title).toBe('index.html (Before turn ↔ Current)');
    expect(
      mocks.provider?.provideTextDocumentContent(baselineUri as MockUri),
    ).toBe('before\n');
    expect(mocks.getExtension).not.toHaveBeenCalled();

    await opener.openDiff('index.html', scope);
    expect(mocks.executeCommand.mock.calls[1]?.[1]).toMatchObject({
      path: (baselineUri as MockUri).path,
      query: (baselineUri as MockUri).query,
    });
    mocks.closeListener?.({ uri: baselineUri as MockUri });
    expect(
      mocks.provider?.provideTextDocumentContent(baselineUri as MockUri),
    ).toBeUndefined();

    opener.dispose?.();
    expect(mocks.providerDispose).toHaveBeenCalledOnce();
    expect(mocks.closeListenerDispose).toHaveBeenCalledOnce();
  });

  it('opens an empty captured baseline for a newly created file', async () => {
    const opener = createVscodeFileDiffOpener(
      reader(''),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('opened-diff');

    const baselineUri = mocks.executeCommand.mock.calls[0]?.[1] as
      | MockUri
      | undefined;
    expect(baselineUri).toMatchObject({
      scheme: 'droidvisx-turn-baseline',
      query: '1',
    });
    expect(baselineUri?.path).toMatch(/index\.html$/);
    expect(
      baselineUri === undefined
        ? undefined
        : mocks.provider?.provideTextDocumentContent(baselineUri),
    ).toBe('');
    expect(mocks.getExtension).not.toHaveBeenCalled();
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    opener.dispose?.();
  });

  it('falls back to the current file when the baseline diff is rejected outside git', async () => {
    mocks.executeCommand.mockRejectedValueOnce(
      new Error('diff editor rejected the virtual document'),
    );
    const opener = createVscodeFileDiffOpener(
      reader(''),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('opened-file');

    const baselineUri = mocks.executeCommand.mock.calls[0]?.[1] as
      MockUri;
    expect(
      mocks.provider?.provideTextDocumentContent(baselineUri),
    ).toBeUndefined();
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: 'C:\\workspace\\index.html',
      }),
      { preview: true },
    );
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        name: 'host.file-diff.open-failed',
        attributes: {
          phase: 'turn-baseline',
          path: 'index.html',
        },
      }),
    );
    opener.dispose?.();
  });

  it('opens the current file when neither a turn baseline nor HEAD exists', async () => {
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('opened-file');

    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: 'C:\\workspace\\index.html',
      }),
      { preview: true },
    );
    opener.dispose?.();
  });

  it('uses the shared git API and a repository-relative HEAD path', async () => {
    const getObjectDetails = vi.fn(async () => ({}));
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('opened-diff');

    expect(getObjectDetails).toHaveBeenCalledWith('HEAD', 'index.html');
    expect(mocks.executeCommand.mock.calls[0]?.[1]).toMatchObject({
      scheme: 'git',
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    opener.dispose?.();
  });

  it('reviews an uncommitted deletion against HEAD', async () => {
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    const getObjectDetails = vi.fn(async () => ({}));
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'history-turn',
      }),
    ).resolves.toBe('opened-diff');

    const workingUri = mocks.executeCommand.mock.calls[0]?.[2] as
      MockUri;
    expect(workingUri.scheme).toBe('droidvisx-turn-baseline');
    expect(
      mocks.provider?.provideTextDocumentContent(workingUri),
    ).toBe('');
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    opener.dispose?.();
  });

  it('opens the committed turn after Reload instead of an empty HEAD diff', async () => {
    const getObjectDetails = vi.fn(async () => ({}));
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff(
        'index.html',
        { sessionId: 'session-a', turnId: 'history-turn' },
        { committedRef: 'abc1234' },
      ),
    ).resolves.toBe('opened-diff');

    expect(getObjectDetails.mock.calls).toEqual([
      ['abc1234^', 'index.html'],
      ['abc1234', 'index.html'],
    ]);
    const [, beforeUri, afterUri, title] =
      mocks.executeCommand.mock.calls[0] ?? [];
    expect(JSON.parse((beforeUri as MockUri).query)).toMatchObject({
      ref: 'abc1234^',
    });
    expect(JSON.parse((afterUri as MockUri).query)).toMatchObject({
      ref: 'abc1234',
    });
    expect(title).toBe('index.html (Committed abc1234)');
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith({
      level: 'info',
      name: 'host.file-diff.opened',
      attributes: {
        source: 'committed-turn',
        path: 'index.html',
        ref: 'abc1234',
      },
    });
    opener.dispose?.();
  });

  it('keeps a committed deletion reviewable after the file is gone', async () => {
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    const getObjectDetails = vi.fn(
      async (ref: string) => {
        if (ref === 'abc1234') {
          throw new Error('deleted');
        }
        return {};
      },
    );
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff(
        'index.html',
        { sessionId: 'session-a', turnId: 'history-turn' },
        { committedRef: 'abc1234' },
      ),
    ).resolves.toBe('opened-diff');

    const afterUri = mocks.executeCommand.mock.calls[0]?.[2] as MockUri;
    expect(afterUri.scheme).toBe('droidvisx-turn-baseline');
    expect(
      mocks.provider?.provideTextDocumentContent(afterUri),
    ).toBe('');
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    opener.dispose?.();
  });

  it('keeps a committed creation reviewable with an empty parent side', async () => {
    const getObjectDetails = vi.fn(
      async (ref: string) => {
        if (ref === 'abc1234^') {
          throw new Error('not present in parent');
        }
        return {};
      },
    );
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff(
        'index.html',
        { sessionId: 'session-a', turnId: 'history-turn' },
        { committedRef: 'abc1234' },
      ),
    ).resolves.toBe('opened-diff');

    const beforeUri = mocks.executeCommand.mock.calls[0]?.[1] as
      MockUri;
    const afterUri = mocks.executeCommand.mock.calls[0]?.[2] as MockUri;
    expect(beforeUri.scheme).toBe('droidvisx-turn-baseline');
    expect(
      mocks.provider?.provideTextDocumentContent(beforeUri),
    ).toBe('');
    expect(afterUri.scheme).toBe('git');
    opener.dispose?.();
  });

  it('logs a rejected committed diff before falling back to HEAD', async () => {
    const getObjectDetails = vi.fn(async () => ({}));
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    mocks.executeCommand.mockRejectedValueOnce(
      new Error('committed diff failed'),
    );
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff(
        'index.html',
        { sessionId: 'session-a', turnId: 'history-turn' },
        { committedRef: 'abc1234' },
      ),
    ).resolves.toBe('opened-diff');

    expect(mocks.executeCommand).toHaveBeenCalledTimes(2);
    expect(mocks.executeCommand.mock.calls[1]?.[1]).toMatchObject({
      scheme: 'git',
    });
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'host.file-diff.open-failed',
        attributes: {
          phase: 'committed-turn',
          path: 'index.html',
        },
        detail: expect.stringContaining('committed diff failed'),
      }),
    );
    opener.dispose?.();
  });

  it('falls back from a rejected baseline diff to the git HEAD diff', async () => {
    const getObjectDetails = vi.fn(async () => ({}));
    mocks.getExtension.mockReturnValue({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: [
            {
              rootUri: { fsPath: 'C:\\workspace' },
              getObjectDetails,
            },
          ],
        }),
      },
    });
    mocks.executeCommand.mockRejectedValueOnce(
      new Error('baseline diff failed'),
    );
    const opener = createVscodeFileDiffOpener(
      reader('before\n'),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('opened-diff');

    expect(mocks.executeCommand).toHaveBeenCalledTimes(2);
    expect(mocks.executeCommand.mock.calls[1]?.[1]).toMatchObject({
      scheme: 'git',
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    opener.dispose?.();
  });

  it('records the underlying editor error when every open path fails', async () => {
    mocks.showTextDocument.mockRejectedValueOnce(
      new Error('plain editor failed'),
    );
    const opener = createVscodeFileDiffOpener(
      reader(undefined),
      diagnostics,
    );

    await expect(
      opener.openDiff('index.html', {
        sessionId: 'session-a',
        turnId: 'turn-a',
      }),
    ).resolves.toBe('failed');

    expect(mocks.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          phase: 'plain-file',
          path: 'index.html',
        },
        detail: expect.stringContaining('plain editor failed'),
      }),
    );
    opener.dispose?.();
  });
});
