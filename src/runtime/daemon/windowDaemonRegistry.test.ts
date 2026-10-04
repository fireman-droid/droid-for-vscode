import { beforeEach, expect, it, vi } from 'vitest';
import { readWindowDaemon } from './windowDaemonRegistry';

const fake = vi.hoisted(() => ({ record: {} as Record<string, unknown> }));
vi.mock('node:fs/promises', () => ({
  stat: async () => ({ size: 1024 }),
  readFile: async () => JSON.stringify(fake.record),
  mkdir: vi.fn(), readdir: vi.fn(), rename: vi.fn(), unlink: vi.fn(), writeFile: vi.fn(),
}));

const id = '11111111-1111-4111-8111-111111111111';
const descriptor = { port: 55000, pid: 55001, token: 'a'.repeat(64) };
beforeEach(() => {
  fake.record = { id, port: 43000, pid: 43001, ownerPid: 43002,
    cwd: 'C:/workspace', idePort: 44000, rootSessionId: 'root-chat' };
});

it('reads an existing daemon with or without a persistent IDE relay', async () => {
  expect(await readWindowDaemon(id)).toEqual(fake.record);
  fake.record.ideRelay = descriptor;
  expect((await readWindowDaemon(id))?.ideRelay).toEqual(descriptor);
});

it.each([
  { ...descriptor, port: 0 },
  { ...descriptor, pid: -1 },
  { ...descriptor, token: 'invalid' },
])('rejects malformed persisted relay capabilities', async invalid => {
  fake.record.ideRelay = invalid;
  await expect(readWindowDaemon(id)).rejects.toThrow('Invalid window daemon discovery record.');
});

it('requires a root session identity for a persisted relay', async () => {
  fake.record.ideRelay = descriptor;
  delete fake.record.rootSessionId;
  await expect(readWindowDaemon(id)).rejects.toThrow('Invalid window daemon discovery record.');
});
