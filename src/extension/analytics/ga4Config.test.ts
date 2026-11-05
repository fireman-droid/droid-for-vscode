import { expect, it } from 'vitest';
import { projectGa4Event } from './ga4Config';

const metadata = {
  machineId: 'machine', sessionId: 'session', extensionVersion: '0.8.20',
  appName: 'Visual Studio Code', platform: 'win32', arch: 'x64', language: 'en',
};

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

it('retains explicit classifications and the successful warmup reason', () => {
  expect(projectGa4Event({
    level: 'error', name: 'daemon.sidecar.start-failed',
    attributes: { reason: 'authentication-failed', phase: 'connect' },
  }, metadata)?.params).toMatchObject({ outcome: 'failed', reason: 'authentication-failed', phase: 'connect' });
  expect(projectGa4Event({
    level: 'info', name: 'daemon.sidecar.warmed',
  }, metadata)?.params.reason).toBe('ok');
});
