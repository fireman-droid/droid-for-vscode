import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { MODEL_CATALOG_FAILED_MESSAGE, projectModelCatalog } from './capabilityPanels';
import type { CapturedSessionIdentity } from '../operationEligibility';
import type { SessionMetadataPort } from './sessionMetadataPort';
import {
  elapsedMs,
  finishSessionSwitchTiming,
  type SessionSwitchTimings,
} from '../sessions/sessionSwitchTimings';
import { projectConfirmedSettings, SETTINGS_READ_FAILED_MESSAGE } from './settings';

/** Loads the independent post-activation settings, model, and panel state. */
export function loadSessionMetadata(
  ctl: SessionMetadataPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
  timings?: SessionSwitchTimings,
): void {
  void runtime.readSessionSettings().then(
    (result) => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.settings = {
        status: 'ready',
        value: projectConfirmedSettings(result),
      };
      ctl.effects.emitSettings(sessionId);
    },
    () => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.settings = {
        status: 'error',
        value: null,
        message: SETTINGS_READ_FAILED_MESSAGE,
      };
      ctl.effects.emitSettings(sessionId);
    },
  );

  void runtime.readModelCatalog().then(
    (result) => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.modelCatalog = projectModelCatalog(result);
      ctl.effects.emitModelCatalog(sessionId);
    },
    () => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.modelCatalog = {
        status: 'error',
        items: [],
        message: MODEL_CATALOG_FAILED_MESSAGE,
      };
      ctl.effects.emitModelCatalog(sessionId);
    },
  );

  const contextStartedAt = performance.now();
  ctl.effects.refreshContext(
    runtime,
    generation,
    sessionId,
    cwd,
    timings === undefined
      ? undefined
      : () => {
          timings.contextMs = elapsedMs(contextStartedAt);
          recordSwitchTiming(ctl, timings);
        },
  );
  // A session switch resets these catalogs to idle. The captured
  // activation identity lets only these metadata pushes bypass the
  // user-panel eligibility while replacement is still settling.
  const activation: CapturedSessionIdentity = {
    runtime,
    generation,
    sessionId,
    cwd,
  };
  ctl.effects.pushActivationSkills(activation);
  ctl.effects.pushActivationMcp(activation);
}

/** Marks activation complete; context may have settled first. */
export function markSessionSwitchReady(
  ctl: SessionMetadataPort,
  timings: SessionSwitchTimings,
): void {
  timings.ready = true;
  recordSwitchTiming(ctl, timings);
}

function recordSwitchTiming(
  ctl: SessionMetadataPort,
  timings: SessionSwitchTimings,
): void {
  const event = finishSessionSwitchTiming(timings);
  if (event !== null) {
    ctl.recordHost(event);
  }
}
