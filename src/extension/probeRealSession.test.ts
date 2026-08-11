// Real-data probe for the crash session 40ebe83d (cwd
// D:\E\前端好玩的东西\react+ts\面试算法): reconciles the recovered
// checkpoint from the local temp export against the cached loaded
// history projection captured by artifacts/probe-reconcile-lcs.mts.
// Machine-local data; the whole suite self-skips when the files are
// absent. The sanitized equivalent lives in
// __fixtures__/reconcileRealSession.ts and always runs.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import { reconcileSessionHistory } from './reconcileSessionHistory';

const RECOVERY_JSON =
  'C:/Users/ASUS/AppData/Local/Temp/dvx-recovery2.json';
const LOADED_CACHE = 'artifacts/tmp/probe-loaded-40ebe83d.json';
const SESSION_ID = '40ebe83d-c937-4d06-a4a5-c8b2daa5dd65';
const CRASH_TIME_LOADED_LENGTH = 78;

const hasRealData =
  existsSync(RECOVERY_JSON) && existsSync(LOADED_CACHE);

describe.skipIf(!hasRealData)(
  'reconcileSessionHistory against the real crash session',
  () => {
    it('no longer duplicates the conversation', () => {
      const recovered = readRecovered();
      const loadedFull = readLoaded();
      const crashTimeLoaded = loadedFull.slice(
        0,
        CRASH_TIME_LOADED_LENGTH,
      );

      for (const loaded of [crashTimeLoaded, loadedFull]) {
        const result = reconcileSessionHistory(
          state(loaded),
          state(recovered),
        );

        // Before the fix the overlap match returned 0 and the merge
        // concatenated both sides (72 + 78 = 150 items). Now the
        // result is the loaded body plus at most the small
        // rewind-branch prefix the SDK no longer returns.
        expect(result.transcript.length).toBeGreaterThanOrEqual(
          loaded.length,
        );
        expect(result.transcript.length).toBeLessThanOrEqual(
          loaded.length + 3,
        );

        const messageIds = result.transcript
          .filter((item) => item.kind === 'user')
          .map((item) => (item as { messageId?: string }).messageId)
          .filter((id): id is string => id !== undefined);
        expect(new Set(messageIds).size).toBe(messageIds.length);

        const toolUseIds = result.transcript
          .filter((item) => item.kind === 'tool')
          .map((item) => (item as { toolUseId: string }).toolUseId);
        expect(new Set(toolUseIds).size).toBe(toolUseIds.length);
      }
    });
  },
);

function readRecovered(): readonly SessionTranscriptItem[] {
  const payload = JSON.parse(readFileSync(RECOVERY_JSON, 'utf8')) as {
    readonly [key: string]: {
      readonly [key: string]: {
        readonly sessions: readonly {
          readonly sessionId: string;
          readonly transcript: readonly SessionTranscriptItem[];
        }[];
      };
    };
  };
  const session = payload['droidvisx.droidvisx'][
    'droidvisx.sessionRecovery'
  ].sessions.find((entry) => entry.sessionId === SESSION_ID);
  if (session === undefined) {
    throw new Error(`session ${SESSION_ID} missing from recovery JSON`);
  }
  return session.transcript;
}

function readLoaded(): readonly SessionTranscriptItem[] {
  return JSON.parse(
    readFileSync(LOADED_CACHE, 'utf8'),
  ) as readonly SessionTranscriptItem[];
}

function state(
  transcript: readonly SessionTranscriptItem[],
): HostTranscriptState {
  return {
    transcript,
    historyStatus: 'complete',
    truncated: false,
  };
}
