import { describe, expect, it } from 'vitest';
import { isAutomationSchedule, type AutomationDraft } from './automationProtocol';
import { MANAGEMENT_VERSION, parseManagementHostMessage, parseManagementRequest } from './managementPageProtocol';

const draft: AutomationDraft = { name: 'Daily checks', description: '', prompt: 'Check the repository.',
  schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '' };
const request = (action: unknown) => ({ type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'request', action });

describe('Automation bridge boundary', () => {
  it.each(['0 9 * * 1-5', '*/15 * * * *', '0,30 8-17/2 * 1,6 0,7'])('accepts supported UTC schedules: %s', value => {
    expect(isAutomationSchedule(value)).toBe(true);
  });
  it.each(['', 'daily', '* * * *', '60 9 * * *', '* 24 * * *', '*/0 * * * *', '* * 0 * *', '* * * 13 *', '* * * * 9', '0 9-1 * * *'])(
    'rejects invalid schedules: %s', value => expect(isAutomationSchedule(value)).toBe(false),
  );
  it('accepts complete drafts but rejects hidden backend controls and malformed mutations', () => {
    expect(parseManagementRequest(request({ kind: 'automations.create', draft }))).toBeDefined();
    for (const action of [
      { kind: 'automations.create', draft: { ...draft, basePath: '/other' } },
      { kind: 'automations.create', draft: { ...draft, prompt: ' ' } },
      { kind: 'automations.run', id: '../other', revision: 'a'.repeat(64) },
      { kind: 'automations.update', id: 'daily', revision: 'stale', draft },
      { kind: 'automations.history', id: 'daily', offset: -1 },
      { kind: 'automations.history', id: 'daily', offset: 0.5 },
    ]) expect(parseManagementRequest(request(action))).toBeUndefined();
  });
  it('rejects old management clients and malformed history responses', () => {
    expect(parseManagementRequest({ ...request({ kind: 'automations.list' }), version: 1 })).toBeUndefined();
    expect(parseManagementHostMessage({ type: 'management.result', version: MANAGEMENT_VERSION, requestId: 'request', ok: true,
      automationHistory: { id: 'daily', offset: 0, total: 1, runs: [{ id: 'run', status: 'success', startedAt: 1 }] },
    })).toBeUndefined();
  });
});
