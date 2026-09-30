import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import { toWorkspaceRelativePath } from './toolFilePath';

export interface ToolDisplayPath {
  readonly path: string;
  /** Labels already returned tool evidence; never grants filesystem access. */
  readonly scope?: 'mission';
}

const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Classify CLI Mission artifacts without treating them as workspace files. */
export function missionArtifactDisplayPath(workspace: string, rawPath: string): ToolDisplayPath | undefined {
  if (rawPath.length > 4_096 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(rawPath)) return undefined;
  const within = relative(resolve(homedir(), '.factory', 'missions'), resolve(workspace, rawPath));
  if (isAbsolute(within)) return undefined;
  const normalized = within.replaceAll('\\', '/');
  const [missionId] = normalized.split('/');
  if (!missionId || !MISSION_ID.test(missionId) || !isSafeWorkspaceRelativePath(normalized)) return undefined;
  const path = `Mission/${normalized}`;
  return isSafeWorkspaceRelativePath(path) ? { path, scope: 'mission' } : undefined;
}

/** Display identity only. Filesystem operations keep using toWorkspaceRelativePath. */
export function toolDisplayPath(workspace: string, rawPath: string): ToolDisplayPath | undefined {
  const mission = missionArtifactDisplayPath(workspace, rawPath);
  if (mission) return mission;
  const path = toWorkspaceRelativePath(workspace, rawPath);
  return path === undefined ? undefined : { path };
}
