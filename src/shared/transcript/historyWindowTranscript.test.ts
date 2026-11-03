import { expect, it } from 'vitest';
import { historyWindowTranscript } from './historyWindowTranscript';
import type { HistoryWindowState } from '../protocol/historyPaging';
import type { SessionTranscriptItem } from '../protocol/transcript';

const prompt = (id: string): SessionTranscriptItem => ({ kind: 'user', id, messageId: id, text: id });
const view = (items: readonly SessionTranscriptItem[], hasNewer = false): HistoryWindowState => ({
  version: 'v', revision: 1, items, hasOlder: true, hasNewer, loading: null, error: null, truncated: false,
});
it('keeps live updates out of an older reading window and merges overlap only at the latest edge', () => {
  const older = prompt('old'), overlap = prompt('overlap'), latest = prompt('latest');
  expect(historyWindowTranscript(view([older, overlap]), [overlap, latest])).toEqual([older, overlap, latest]);
  expect(historyWindowTranscript(view([older], true), [overlap, latest])).toEqual([older]);
});
