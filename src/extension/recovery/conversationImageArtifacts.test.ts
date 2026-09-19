import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createConversationImageArtifactStore } from './conversationImageArtifacts';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { readRecoverySession, writeRecoverySession } from './recoveryStoreTestSupport';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('conversation image artifacts', () => {
  it('restores persisted image bytes into the exact V2 display snapshot', async () => {
    const directory = await createTemporaryDirectory();
    const persistence = memoryPersistence();
    const artifacts = createConversationImageArtifactStore(directory);
    const store = new SessionRecoveryStore(persistence, 'recovery', 0, artifacts);
    writeRecoverySession(store, 'session-1', {
      transcript: [image('image-1', 'aGVsbG8=', 5)],
      historyStatus: 'complete',
      truncated: false,
    });

    await store.flush();

    expect(JSON.stringify(persistence.value)).not.toContain('aGVsbG8=');
    expect(await readdir(directory)).toHaveLength(1);

    const reloaded = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
      createConversationImageArtifactStore(directory),
    );
    await reloaded.load();
    expect(readRecoverySession(reloaded, 'session-1')).toMatchObject({
      historyStatus: 'complete',
      transcript: [
        expect.objectContaining({
          id: 'image-1',
          data: 'aGVsbG8=',
          byteLength: 5,
        }),
      ],
    });
  });

  it('keeps a missing image row in place and marks recovery partial', async () => {
    const directory = await createTemporaryDirectory();
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
      createConversationImageArtifactStore(directory),
    );
    writeRecoverySession(store, 'session-1', {
      transcript: [image('image-1', 'aGVsbG8=', 5)],
      historyStatus: 'complete',
      truncated: false,
    });
    await store.flush();
    await rm(directory, { recursive: true, force: true });

    const reloaded = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
      createConversationImageArtifactStore(directory),
    );
    await reloaded.load();

    expect(readRecoverySession(reloaded, 'session-1')).toMatchObject({
      historyStatus: 'partial',
      transcript: [
        expect.objectContaining({
          id: 'image-1',
          data: '',
          byteLength: 5,
        }),
      ],
    });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'droidvisx-conversation-images-'));
  temporaryDirectories.push(directory);
  return directory;
}

function image(id: string, data: string, byteLength: number) {
  return {
    id,
    kind: 'image' as const,
    turnId: 'turn-1',
    origin: 'tool-result' as const,
    mediaType: 'image/png' as const,
    data,
    generated: false,
    byteLength,
  };
}

function memoryPersistence() {
  const persistence = { value: undefined as unknown };
  return {
    get<T>(): T | undefined {
      return persistence.value as T | undefined;
    },
    async update(_key: string, value: unknown): Promise<void> {
      persistence.value = value;
    },
    get value(): unknown {
      return persistence.value;
    },
  } satisfies SessionRecoveryPersistence & { readonly value: unknown };
}
