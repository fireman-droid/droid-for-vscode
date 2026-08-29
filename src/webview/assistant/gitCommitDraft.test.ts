import { describe, expect, it } from 'vitest';

import type {
  ChangesTranscriptItem,
  SessionTranscriptItem,
  UserTranscriptItem,
} from '../../shared/bridgeMessages';
import {
  findLatestChangesContext,
  findLatestChangesItem,
} from './gitCommitDraft';

const changedQuestion: UserTranscriptItem = {
  id: 'user-turn-a',
  kind: 'user',
  text: 'Update the page',
};
const changes: ChangesTranscriptItem = {
  id: 'changes-turn-a',
  kind: 'changes',
  turnId: 'turn-a',
  files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
};

const laterQuestion: UserTranscriptItem = {
  id: 'user-turn-b',
  kind: 'user',
  text: 'How much context is left?',
};

describe('findLatestChangesItem', () => {
  it('keeps the latest changed turn visible after later chat-only turns', () => {
    const transcript: readonly SessionTranscriptItem[] = [
      changedQuestion,
      changes,
      laterQuestion,
    ];

    expect(findLatestChangesItem(transcript)).toBe(changes);
    expect(findLatestChangesContext(transcript)).toEqual({
      turnId: 'turn-a',
      prompt: 'Update the page',
    });
  });
});
