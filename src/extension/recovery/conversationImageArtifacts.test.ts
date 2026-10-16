import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createConversationImageArtifactStore } from './conversationImageArtifacts';
import { createRootConversation } from './conversationRecoveryState';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('conversation image artifacts', () => {
  it('restores persisted image bytes from an artifact record', async () => {
    const directory = await createTemporaryDirectory();
    const artifacts = createConversationImageArtifactStore(directory);
    const conversation = createRootConversation('session-1', {
      transcript: [image('image-1', 'aGVsbG8=', 5)], historyStatus: 'complete', truncated: false,
    }, 1);
    await artifacts.persist([conversation]);
    expect(await readdir(directory)).toHaveLength(1);
    const placeholder = { ...conversation, display: { ...conversation.display, transcript: {
      ...conversation.display.transcript, transcript: [image('image-1', '', 5)],
    } } };
    const result = await createConversationImageArtifactStore(directory).hydrate([placeholder]);
    expect(result.missing).toBe(0);
    expect(result.conversations[0]?.display.transcript.transcript).toEqual([image('image-1', 'aGVsbG8=', 5)]);
  });
  it('keeps a missing image row in place and marks recovery partial', async () => {
    const directory = await createTemporaryDirectory();
    const conversation = createRootConversation('session-1', {
      transcript: [image('image-1', 'aGVsbG8=', 5)], historyStatus: 'complete', truncated: false,
    }, 1);
    await createConversationImageArtifactStore(directory).persist([conversation]);
    await rm(directory, { recursive: true, force: true });
    const placeholder = { ...conversation, display: { ...conversation.display, transcript: {
      ...conversation.display.transcript, transcript: [image('image-1', '', 5)],
    } } };
    const result = await createConversationImageArtifactStore(directory).hydrate([placeholder]);
    expect(result.missing).toBe(1);
    expect(result.conversations[0]?.display.transcript).toMatchObject({ historyStatus: 'partial', transcript: [image('image-1', '', 5)] });
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
