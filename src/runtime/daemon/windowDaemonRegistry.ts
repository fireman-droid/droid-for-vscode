import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isSafeSessionIdentifier } from '../catalog/SessionCatalog';
import { defaultDiscoveryFile, readDaemonDiscovery } from './daemonDiscovery';
import { removeIdeDaemonSnapshot } from './ideDaemonFeatures';

export interface WindowDaemonRecord {
  readonly id: string;
  readonly port: number;
  readonly pid: number;
  readonly ownerPid: number;
  readonly cwd: string;
  readonly idePort: number | null;
  /** Absent on legacy shared daemons and the window's metadata-only daemon. */
  readonly rootSessionId?: string;
}

const root = join(homedir(), '.droidvisx', 'window-daemons');
const instanceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function windowDaemonUrl(record: WindowDaemonRecord): string {
  return `ws://127.0.0.1:${record.port}`;
}

export async function writeWindowDaemon(record: WindowDaemonRecord): Promise<void> {
  await atomicWrite(join(root, `${record.id}.json`), record);
}

export async function removeWindowDaemon(record: WindowDaemonRecord): Promise<void> {
  if (!instanceId.test(record.id)) return;
  const file = join(root, `${record.id}.json`);
  const value = await readRecord(file);
  if (value?.pid !== record.pid || value.port !== record.port) return;
  await removeIdeDaemonSnapshot(record.id);
  await unlink(file);
}

export async function readWindowDaemon(id: string): Promise<WindowDaemonRecord | null> {
  if (id === 'legacy') {
    const legacy = readDaemonDiscovery(defaultDiscoveryFile());
    return legacy ? {
      id, port: legacy.port, pid: legacy.pid, ownerPid: 0, cwd: '', idePort: null,
    } : null;
  }
  if (!instanceId.test(id)) throw new Error('Invalid daemon instance identity.');
  const record = await readRecord(join(root, `${id}.json`));
  if (record && record.id !== id) throw new Error('Daemon discovery identity does not match its file.');
  return record;
}

export async function listWindowDaemons(): Promise<WindowDaemonRecord[]> {
  let names: string[];
  try { names = await readdir(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = [];
    else throw error;
  }
  const records = (await Promise.all(names
    .filter((name) => name.endsWith('.json') && instanceId.test(name.slice(0, -5)))
    .map((name) => readWindowDaemon(name.slice(0, -5)))))
    .filter((record): record is WindowDaemonRecord => record !== null);
  // Read-only compatibility with the previously shared daemon.
  const legacy = await readWindowDaemon('legacy');
  if (legacy) records.push(legacy);
  return records;
}

export async function readSessionDaemon(sessionId: string): Promise<string | null> {
  const value = await readJson(sessionFile(sessionId));
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) ||
      typeof value.instanceId !== 'string' ||
      (value.instanceId !== 'legacy' && !instanceId.test(value.instanceId))) {
    throw new Error('Invalid session daemon ownership record.');
  }
  return value.instanceId;
}

export async function writeSessionDaemon(sessionId: string, id: string): Promise<void> {
  if (id !== 'legacy' && !instanceId.test(id)) throw new Error('Invalid daemon instance identity.');
  await atomicWrite(sessionFile(sessionId), { instanceId: id });
}

function sessionFile(sessionId: string): string {
  if (!isSafeSessionIdentifier(sessionId)) throw new Error('Invalid session identity.');
  return join(root, 'sessions', `${sessionId}.json`);
}

async function readRecord(file: string): Promise<WindowDaemonRecord | null> {
  const value = await readJson(file);
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) ||
      typeof value.id !== 'string' || !instanceId.test(value.id) ||
      !validPort(value.port) || !validPid(value.pid) || !validPid(value.ownerPid) ||
      typeof value.cwd !== 'string' || value.cwd.length > 32_768 ||
      (value.rootSessionId !== undefined &&
        (typeof value.rootSessionId !== 'string' || !isSafeSessionIdentifier(value.rootSessionId))) ||
      (value.idePort !== null && !validPort(value.idePort))) {
    throw new Error('Invalid window daemon discovery record.');
  }
  return value as unknown as WindowDaemonRecord;
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}

function validPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    if ((await stat(file)).size > 65_536) throw new Error('Daemon ownership record is too large.');
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(join(root, 'sessions'), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
