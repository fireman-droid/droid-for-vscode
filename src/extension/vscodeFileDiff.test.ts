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
    provideTextDocumentContent(uri: MockUri): string;
  } | null,
  providerDispose: vi.fn(),
  closeListener: null as ((document: { uri: MockUri }) => void) | null,
  closeListenerDispose: vi.fn(),
  stat: vi.fn(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  getExtension: vi.fn(),
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
      }: {
        scheme: string;
        path: string;
      }) => makeUri(scheme, path),
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
    const opener = createVscodeFileDiffOpener(changeStats);
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
    });
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
    });
    mocks.closeListener?.({ uri: baselineUri as MockUri });
    expect(
      mocks.provider?.provideTextDocumentContent(baselineUri as MockUri),
    ).toBe('');

    opener.dispose?.();
    expect(mocks.providerDispose).toHaveBeenCalledOnce();
    expect(mocks.closeListenerDispose).toHaveBeenCalledOnce();
  });

  it('opens the current file when neither a turn baseline nor HEAD exists', async () => {
    const opener = createVscodeFileDiffOpener(reader(undefined));

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
    const opener = createVscodeFileDiffOpener(reader(undefined));

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
});
