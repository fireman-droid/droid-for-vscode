import { expect, it } from 'vitest';
import { createTurnActivityState, projectToolEvent } from './turnActivityState';
import { projectToolFields } from '../../../shared/transcript/toolFields';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';

it('enriches a completed Script child Diff without restarting it or extending its duration', () => {
  const tool = { toolUseId: 'patch', toolName: 'ApplyPatch', action: 'Apply patch' };
  let projected = projectToolEvent(createTurnActivityState(), { type: 'tool-start', ...tool, scriptParentId: 'script' }, 100);
  projected = projectToolEvent(projected.state, { type: 'tool-result', ...tool, isError: false,
    operationDiff: { status: 'unavailable', reason: 'not-recorded' } }, 300);
  expect(projected.projection).toMatchObject({ status: 'completed', durationMs: 200, scriptParentId: 'script' });
  projected = projectToolEvent(projected.state, { type: 'tool-result', ...tool, isError: false,
    operationDiff: { status: 'ready', source: 'tool-result', callId: 'patch', files: [
      { path: 'a.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-old\n+new' },
    ] } }, 5000);
  expect(projected.projection).toMatchObject({ status: 'completed', durationMs: 200, scriptParentId: 'script', operationDiff: { status: 'ready' } });
  const fields = projectToolFields({ type: 'tool.activity', sessionId: 'session', sequence: 3, turnId: 'turn', ...projected.projection! });
  expect(fields).toMatchObject({ scriptParentId: 'script', operationDiff: { status: 'ready' } });
  const existing: ToolTranscriptItem = { id: 'row', kind: 'tool', ...fields };
  expect(projectToolFields({ type: 'tool.activity', sessionId: 'session', sequence: 4, ...fields, status: 'completed', scriptParentId: undefined }, existing).scriptParentId).toBe('script');
});
