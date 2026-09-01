import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import {
  cloneConversation,
  cloneTranscriptState,
  type ConversationRecoveryRecord,
} from './conversationRecoveryState';

const ARTIFACT_EXTENSION = '.bin';

export interface ConversationImageArtifactStore {
  persist(
    conversations: readonly ConversationRecoveryRecord[],
  ): Promise<void>;
  hydrate(
    conversations: readonly ConversationRecoveryRecord[],
  ): Promise<{
    readonly conversations: readonly ConversationRecoveryRecord[];
    readonly missing: number;
  }>;
  prune(
    conversations: readonly ConversationRecoveryRecord[],
  ): Promise<void>;
  remove(artifactIds: readonly string[]): Promise<void>;
}

export function createConversationImageArtifactStore(
  storageDir: string,
): ConversationImageArtifactStore {
  const cachedData = new Map<string, string>();

  return {
    async persist(conversations) {
      await mkdir(storageDir, { recursive: true });
      for (const conversation of conversations) {
        const items = imageItems(conversation);
        for (const artifact of conversation.display.images) {
          const item = items.get(artifact.itemId);
          if (
            item === undefined ||
            item.data.length === 0 ||
            cachedData.get(artifact.artifactId) === item.data
          ) {
            continue;
          }
          const bytes = Buffer.from(item.data, 'base64');
          if (bytes.byteLength !== artifact.byteLength) {
            throw new Error('Conversation image byte length mismatch');
          }
          const target = artifactPath(storageDir, artifact.artifactId);
          const temporary = `${target}.${process.pid}.tmp`;
          await writeFile(temporary, bytes);
          await rename(temporary, target);
          cachedData.set(artifact.artifactId, item.data);
        }
      }
    },

    async hydrate(conversations) {
      let missing = 0;
      const hydrated: ConversationRecoveryRecord[] = [];
      for (const source of conversations) {
        const conversation = cloneConversation(source);
        let conversationMissing = 0;
        const dataByItem = new Map<string, string>();
        for (const artifact of conversation.display.images) {
          try {
            const bytes = await readFile(
              artifactPath(storageDir, artifact.artifactId),
            );
            if (bytes.byteLength !== artifact.byteLength) {
              missing += 1;
              conversationMissing += 1;
              continue;
            }
            const data = bytes.toString('base64');
            cachedData.set(artifact.artifactId, data);
            dataByItem.set(artifact.itemId, data);
          } catch {
            missing += 1;
            conversationMissing += 1;
          }
        }
        hydrated.push({
          ...conversation,
          display: {
            ...conversation.display,
            transcript: {
              ...cloneTranscriptState(conversation.display.transcript),
              transcript:
                conversation.display.transcript.transcript.map((item) =>
                  item.kind === 'image' &&
                  dataByItem.has(item.id)
                    ? { ...item, data: dataByItem.get(item.id)! }
                    : { ...item },
                ),
              historyStatus:
                conversationMissing > 0
                  ? 'partial'
                  : conversation.display.transcript.historyStatus,
            },
          },
        });
      }
      return { conversations: hydrated, missing };
    },

    async prune(conversations) {
      const referenced = new Set(
        conversations.flatMap((conversation) =>
          conversation.display.images.map(
            (artifact) => artifact.artifactId,
          ),
        ),
      );
      let entries: string[];
      try {
        entries = await readdir(storageDir);
      } catch {
        return;
      }
      await Promise.all(
        entries.flatMap((entry) => {
          if (!entry.endsWith(ARTIFACT_EXTENSION)) {
            return [];
          }
          const artifactId = entry.slice(0, -ARTIFACT_EXTENSION.length);
          return referenced.has(artifactId)
            ? []
            : [
                rm(path.join(storageDir, entry), {
                  force: true,
                }),
              ];
        }),
      );
    },

    async remove(artifactIds) {
      await Promise.all(
        artifactIds.map(async (artifactId) => {
          cachedData.delete(artifactId);
          await rm(artifactPath(storageDir, artifactId), {
            force: true,
          });
        }),
      );
    },
  };
}

function imageItems(
  conversation: ConversationRecoveryRecord,
): ReadonlyMap<
  string,
  Extract<SessionTranscriptItem, { kind: 'image' }>
> {
  return new Map(
    conversation.display.transcript.transcript.flatMap((item) =>
      item.kind === 'image' ? [[item.id, item] as const] : [],
    ),
  );
}

function artifactPath(storageDir: string, artifactId: string): string {
  return path.join(storageDir, `${artifactId}${ARTIFACT_EXTENSION}`);
}
