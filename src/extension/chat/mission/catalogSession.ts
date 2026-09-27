import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { ChatController } from '../ChatController';
import { isUsableWorkspace } from '../internals';

type MissionCatalogSessionPort = Pick<ChatController,
  'missionGateway' | 'getWorkspaceContext' | 'sessionState' | 'effects' | 'emitSnapshot'>;

/** Open a Host-owned Mission target without depending on the recent-chat list. */
export function openCatalogMission(
  ctl: MissionCatalogSessionPort,
  catalogId: string,
): string | null {
  const target = ctl.missionGateway?.targetForCatalogId(catalogId);
  const workspace = ctl.getWorkspaceContext();
  if (!target || !isUsableWorkspace(workspace) || !sameWorkspace(workspace.cwd, target.cwd)) {
    return null;
  }
  if (!ctl.effects.canReplaceSession()) return null;
  if (ctl.sessionState.sessionId === target.sessionId &&
      ctl.sessionState.activeRuntimeCwd === workspace.cwd) {
    ctl.emitSnapshot();
    return target.sessionId;
  }
  ctl.effects.startReplacement({
    kind: 'resume',
    cwd: workspace.cwd,
    sessionId: target.sessionId,
  });
  return target.sessionId;
}

function sameWorkspace(cwd: string, targetCwd: string | null): boolean {
  if (!targetCwd || !path.isAbsolute(targetCwd) || targetCwd.includes('\0')) return false;
  const current = path.resolve(cwd);
  const target = path.resolve(targetCwd);
  const equal = (left: string, right: string) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
  if (equal(current, target)) return true;
  try {
    return equal(realpathSync.native(current), realpathSync.native(target));
  } catch {
    return false;
  }
}
