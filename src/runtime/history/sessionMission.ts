import { MISSION_SESSION_ROLES, MISSION_STATES } from '../../shared/protocol/bounds';
import {
  type MissionSessionRole,
  type MissionState,
  type SessionMissionSummary,
} from '../../shared/protocol/sessions';
import { isStrictRecord } from '../../shared/validation/strictValidation';

const MISSION_STATE_SET: ReadonlySet<string> = new Set(MISSION_STATES);
const MISSION_SESSION_ROLE_SET: ReadonlySet<string> = new Set(MISSION_SESSION_ROLES);

/** Durable CLI tags identify the session itself; a shared Mission store does not. */
export function readMissionRoleFromTags(tags: unknown): MissionSessionRole | null {
  if (!Array.isArray(tags)) return null;
  let orchestrator = false;
  for (const tag of tags) {
    if (!isStrictRecord(tag)) continue;
    const metadata = isStrictRecord(tag.metadata) ? tag.metadata : undefined;
    const role = tag.name === 'decompSessionType' ? metadata?.value
      : tag.name === 'mission-session' ? metadata?.role : undefined;
    // Explicit worker identity must never be promoted by an inherited marker.
    if (role === 'worker') return 'worker';
    if (role === 'orchestrator' || tag.name === 'mission-orchestrator') orchestrator = true;
  }
  return orchestrator ? 'orchestrator' : null;
}

/**
 * Reads the read-only mission identity of a loaded session from a
 * `loadSession()` envelope: `mission.state` plus `decompSessionType`.
 * Unknown values project to null fields; a summary with no known
 * field at all projects to null so callers can omit it entirely.
 */
export function readSessionMission(loaded: unknown): SessionMissionSummary | null {
  if (!isStrictRecord(loaded)) {
    return null;
  }
  const result = loaded.result;
  if (!isStrictRecord(result)) {
    return null;
  }

  const mission = result.mission;
  const rawState = isStrictRecord(mission) ? mission.state : undefined;
  const state =
    typeof rawState === 'string' && MISSION_STATE_SET.has(rawState)
      ? (rawState as MissionState)
      : null;
  const rawRole = result.decompSessionType;
  const role =
    typeof rawRole === 'string' && MISSION_SESSION_ROLE_SET.has(rawRole)
      ? (rawRole as MissionSessionRole)
      : null;

  if (state === null && role === null) {
    return null;
  }
  return { state, role };
}
