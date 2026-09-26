import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isStrictRecord } from '../../shared/validation/strictValidation';

const snapshotEnvironmentKey = 'FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH';

/**
 * Droid 0.228's in-process daemon workers skip initializeIdeConnection.
 * Its own child-process snapshot mechanism keeps IDE sessions in subprocesses.
 * Preserve every other flag/config; never change the user's Factory cache.
 */
export async function prepareIdeDaemonEnvironment(
  instanceId: string,
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const factoryHome = join(environment.FACTORY_HOME_OVERRIDE?.trim() || homedir(), '.factory');
  const source = environment[snapshotEnvironmentKey]?.trim() || join(factoryHome, 'cache', 'feature-flags.json');
  let cached: unknown;
  try { cached = JSON.parse(await readFile(source, 'utf8')); }
  catch (cause) {
    throw new Error('Could not read Droid feature configuration for its IDE-compatible daemon. Start Droid once, then retry.', { cause });
  }
  if (!isStrictRecord(cached) || !isStrictRecord(cached.flags) || !isStrictRecord(cached.configs) ||
      !Object.values(cached.flags).every((value) => typeof value === 'boolean')) {
    throw new Error('Droid feature configuration is invalid; an IDE-compatible daemon could not be prepared.');
  }
  const file = snapshotFile(instanceId);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    flags: { ...cached.flags, shared_process_agents: false },
    configs: cached.configs,
  }), { flag: 'wx', mode: 0o600 });
  // Session subprocesses inherit this path, including after an editor reload.
  // The owning daemon's registry removal is the cleanup boundary.
  return { ...environment, [snapshotEnvironmentKey]: file };
}

export async function removeIdeDaemonSnapshot(instanceId: string): Promise<void> {
  try { await unlink(snapshotFile(instanceId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function snapshotFile(instanceId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(instanceId)) {
    throw new Error('Invalid daemon feature snapshot identity.');
  }
  return join(homedir(), '.droidvisx', 'daemon-features', `${instanceId}.json`);
}
