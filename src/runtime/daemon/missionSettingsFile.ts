import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Droid writes this file under the mission-session tag's missionId (its
 * baseSessionId), not state.json's separate mis_* Mission identity.
 */
export async function hasSavedMissionModelSettings(missionId: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(missionId)) throw new Error('Invalid Mission identity.');
  try {
    const info = await stat(join(homedir(), '.factory', 'missions', missionId, 'model-settings.json'));
    if (!info.isFile()) throw new Error('Mission model settings are not a file.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
