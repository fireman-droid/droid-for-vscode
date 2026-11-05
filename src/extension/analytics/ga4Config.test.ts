import { expect, it } from 'vitest';
import { projectGa4Event } from './ga4Config';

const metadata = {
  machineId: 'machine', sessionId: 'session', extensionVersion: '0.8.20',
  appName: 'Visual Studio Code', platform: 'win32', arch: 'x64', language: 'en',
};

it.each([
  [{ shown: false, status: 'no-replacement', latencyMs: 37 }, 'no-replacement'],
  [{ shown: true, status: 'ok', latencyMs: 37 }, 'suggestion-returned'],
  [{ shown: false, outcome: 'no-replacement', durationMs: 37, reason: 'unchanged-region' }, 'no-replacement'],
])('retains Next Edit decisions and latency without exporting local content', (attributes, outcome) => {
  const event = projectGa4Event({ level: 'debug', name: 'autocomplete.next-edit.result',
    attributes: { ...attributes, suggestionId: 71, model: 'private-model', characters: 20 },
    detail: 'private-code' }, metadata);
  expect(event).toMatchObject({ name: 'autocomplete_activity',
    params: { category: 'next_edit_result', outcome, duration_ms: 37, records: 20 } });
  expect(event?.params).not.toHaveProperty('status_code');
  expect(JSON.stringify(event)).not.toMatch(/private|suggestionId/);
  expect(projectGa4Event({ level: 'debug', name: 'autocomplete.content', detail: 'private-code',
    attributes: { id: 71, stage: 'response' } }, metadata)).toBeUndefined();
});

it.each([
  ['autocomplete.next-edit.apply-failed', 'failed'],
  ['autocomplete.next-edit.discarded', 'discarded'],
  ['autocomplete.next-edit.dismissed', 'dismissed'],
  ['autocomplete.skipped', 'skipped'],
  ['autocomplete.cancelled', 'cancelled'],
  ['autocomplete.context.timeout', 'timeout'],
])('never labels %s as a successful suggestion', (name, outcome) => {
  expect(projectGa4Event({ level: 'debug', name, attributes: { reason: 'editor-state' } }, metadata)?.params)
    .toMatchObject({ outcome, reason: 'editor-state' });
});

it.each([
  ['daemon.sidecar.start-failed', 'spawn'],
  ['daemon.sidecar.start-failed', 'connect'],
  ['daemon.sidecar.warm-failed', undefined],
] as const)('does not label %s (%s) as ok when the reason is absent', (name, phase) => {
  const event = projectGa4Event({
    level: 'error', name, attributes: phase ? { phase } : {},
    detail: 'Private failure at C:/private-project with private credentials',
  }, metadata);
  expect(event).toMatchObject({ name: 'daemon_health', params: { outcome: 'failed', reason: 'unknown' } });
  expect(event?.params.phase).toBe(phase);
  expect(JSON.stringify(event)).not.toMatch(/Private|private-project|credentials/);
});

it.each([
  ['runtime.stream.error', 'failed'],
  ['host.turn.watchdog-stop-unconfirmed', 'unknown'],
] as const)('never reports %s as ok without an explicit outcome', (name, outcome) => {
  expect(projectGa4Event({ level: 'error', name, detail: 'HTTP 403 private-secret' }, metadata)?.params)
    .toMatchObject({ outcome });
});

it.each(['models', 'management', 'review', 'sessionViewer', 'missionControl'])('collects %s frontend failure without its prose', surface => {
  const event = projectGa4Event({ level: 'error', name: `${surface}.error`, detail: 'private-code at C:/private-project' }, metadata);
  expect(event?.name).toBe('frontend_error');
  expect(JSON.stringify(event)).not.toMatch(/private-code|private-project/);
});

it('projects business results and final reconciled turns separately from transport termination', () => {
  const operation = projectGa4Event({ level: 'warn', name: 'host.operation.finished',
    attributes: { operation: 'automations.run', surface: 'management', outcome: 'accepted', durationMs: 20,
      prompt: 'private-prompt', path: 'private-path', id: 'private-id' } }, metadata);
  expect(operation).toMatchObject({ name: 'session_recovery',
    params: { category: 'operation_result', code: 'automations.run', outcome: 'accepted', duration_ms: 20 } });
  expect(JSON.stringify(operation)).not.toContain('private');
  expect(projectGa4Event({ level: 'info', name: 'host.turn.settled',
    attributes: { outcome: 'completed', source: 'durable', durationMs: 50 } }, metadata)).toMatchObject({
    name: 'turn_lifecycle', params: { category: 'settled', outcome: 'completed', source: 'durable' },
  });
  expect(projectGa4Event({ level: 'warn', name: 'host.turn.failed', detail: 'HTTP 429 private',
    attributes: { code: 'runtime-stream-failed' } }, metadata)?.params.failure_kind).toBe('rate_limited');
});

it('retains explicit classifications and the successful warmup reason', () => {
  expect(projectGa4Event({
    level: 'error', name: 'daemon.sidecar.start-failed',
    attributes: { reason: 'authentication-failed', phase: 'connect' },
  }, metadata)?.params).toMatchObject({ outcome: 'failed', reason: 'authentication-failed', phase: 'connect' });
  expect(projectGa4Event({
    level: 'info', name: 'daemon.sidecar.warmed',
  }, metadata)?.params.reason).toBe('ok');
});
