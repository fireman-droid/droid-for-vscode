import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import {
  MAX_DRAFT_SUBJECT_CHARS,
  buildCommitMessageDraft,
  findLatestChangesContext,
  findLatestChangesItem,
} from './gitCommitDraft';

describe('buildCommitMessageDraft', () => {
  it('uses the first non-empty prompt line plus the trailer', () => {
    expect(
      buildCommitMessageDraft('\n  Fix the flaky test  \nmore', 2),
    ).toBe('Fix the flaky test\n\nvia DroidVisX, 2 files');
  });

  it('truncates the subject to 50 code points', () => {
    const prompt = '汉'.repeat(80);
    const draft = buildCommitMessageDraft(prompt, 3);
    const [subject] = draft.split('\n');
    expect(subject).toBe('汉'.repeat(MAX_DRAFT_SUBJECT_CHARS));
  });

  it('degrades to the trailer alone without a prompt', () => {
    expect(buildCommitMessageDraft(null, 4)).toBe(
      'via DroidVisX, 4 files',
    );
    expect(buildCommitMessageDraft('   \n  ', 4)).toBe(
      'via DroidVisX, 4 files',
    );
  });

  it('singularizes one file', () => {
    expect(buildCommitMessageDraft('Do it', 1)).toBe(
      'Do it\n\nvia DroidVisX, 1 file',
    );
  });
});

const user = (id: string, text: string): SessionTranscriptItem => ({
  id,
  kind: 'user',
  text,
});

const changes = (
  id: string,
  turnId: string,
): SessionTranscriptItem => ({
  id,
  kind: 'changes',
  turnId,
  files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
});

describe('findLatestChangesContext', () => {
  it('returns the last changes card with its preceding prompt', () => {
    const context = findLatestChangesContext([
      user('u1', 'first prompt'),
      changes('c1', 'turn-1'),
      user('u2', 'second prompt'),
      {
        id: 'a2',
        kind: 'assistant',
        turnId: 'turn-2',
        text: 'done',
      },
      changes('c2', 'turn-2'),
    ]);
    expect(context).toEqual({
      turnId: 'turn-2',
      prompt: 'second prompt',
    });
  });

  it('returns a null prompt when no user item precedes the card', () => {
    expect(findLatestChangesContext([changes('c1', 'turn-1')])).toEqual(
      { turnId: 'turn-1', prompt: null },
    );
  });

  it('returns null without any changes card', () => {
    expect(
      findLatestChangesContext([user('u1', 'prompt only')]),
    ).toBeNull();
  });

  it('does not carry an older commit context into a newer user turn', () => {
    expect(
      findLatestChangesContext([
        user('u1', 'first prompt'),
        changes('c1', 'turn-1'),
        user('u2', 'new turn without changes'),
      ]),
    ).toBeNull();
  });
});

describe('findLatestChangesItem', () => {
  it('returns the newest Changes item in the current turn segment', () => {
    const newest = changes('c2', 'turn-2');
    expect(
      findLatestChangesItem([
        user('u1', 'first'),
        changes('c1', 'turn-1'),
        user('u2', 'second'),
        newest,
      ]),
    ).toBe(newest);
  });

  it('does not carry an older ReviewDock into a newer user turn', () => {
    expect(
      findLatestChangesItem([
        user('u1', 'first'),
        changes('c1', 'turn-1'),
        user('u2', 'new turn without changes'),
      ]),
    ).toBeNull();
  });
});
