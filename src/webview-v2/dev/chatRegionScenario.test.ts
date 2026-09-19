import { expect, it } from 'vitest';
import { getStudioScenario } from '../../webview/dev/scenarios';
import { readHostMessage } from '../../webview/bridge/validateHostMessage';
import { describeTranscript } from '../../webview/assistant/transcript/transcriptGroups';

it('accepts the comparison fixture through the production bridge and retains completed Todo snapshots in V2 activity', () => {
  const snapshot = readHostMessage(getStudioScenario('chat-region').build(() => 0)[0]);
  expect(snapshot?.type).toBe('host.snapshot');
  if (snapshot?.type !== 'host.snapshot') throw new Error('Comparison snapshot was rejected');
  const items = describeTranscript(snapshot.transcript, { includePlanSnapshots: true }).descriptors
    .flatMap((descriptor) => descriptor.kind === 'assistant' ? descriptor.items : []);
  expect(items.find((item) => item.id === 'chat-region-todo')).toMatchObject({
    kind: 'tool', detailKind: 'plan', status: 'completed',
  });
  expect(items.find((item) => item.id === 'chat-region-failure')).toMatchObject({
    kind: 'tool', status: 'failed', errorMessage: 'Process exited with code 1',
  });
  expect(describeTranscript(snapshot.transcript).descriptors
    .flatMap((descriptor) => descriptor.kind === 'assistant' ? descriptor.items : [])
    .some((item) => item.id === 'chat-region-todo')).toBe(false);
});
