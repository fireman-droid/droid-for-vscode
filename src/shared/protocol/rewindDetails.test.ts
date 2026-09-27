import { expect, it } from 'vitest';
import { readHostMessage } from '../../webview-v2/bridge/validateHostMessage';
import { rewindDetailSummary } from './rewindDetails';
import { projectRewindInfo } from '../../runtime/session/rewindInfo';

it('carries outside, created and unavailable files through the Bridge without exposing absolute paths', () => {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  const outside = process.platform === 'win32' ? 'C:\\private\\settings.json' : '/private/settings.json';
  const info = projectRewindInfo({ availableFiles: [{ filePath: outside }], createdFiles: [],
    evictedFiles: [{ filePath: outside, reason: 'size-limit' }] }, root);
  const message = { type: 'rewind.info', sequence: 1, sessionId: 's', messageId: 'm', ...info };
  expect(readHostMessage(message)).toEqual(message);
  expect(JSON.stringify(message)).not.toContain(outside);
  expect(rewindDetailSummary(info)).toMatchObject({ unavailableCount: 1, omittedAffected: 0, omittedUnavailable: 0 });
  expect(readHostMessage({ ...message, restorableCount: 0 })).toBeUndefined();
  expect(readHostMessage({ ...message, details: [{ label: outside, location: 'outside-workspace', action: 'restore' }] })).toBeUndefined();
  expect(rewindDetailSummary({ ...info, details: [] })).toMatchObject({ omittedAffected: 1, omittedUnavailable: 1 });
});
