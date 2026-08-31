import type { DroidRuntime } from '../../runtime/DroidRuntime';
import {
  emitModelCatalog,
  MODEL_CATALOG_FAILED_MESSAGE,
  projectModelCatalog,
  pushActivationSkills,
  refreshContext,
} from './capabilityPanels';
import { pushActivationMcp } from './mcp';
import {
  emitSettings,
  projectConfirmedSettings,
  SETTINGS_READ_FAILED_MESSAGE,
} from './settings';
import type { ChatControllerInternals } from './internals';
import type { CapturedSessionIdentity } from './operationEligibility';
import {
  elapsedMs,
  finishSessionSwitchTiming,
  type SessionSwitchTimings,
} from './sessionSwitchTimings';

/** Loads the independent post-activation settings, model, and panel state. */
export function loadSessionMetadata(
  ctl: ChatControllerInternals,
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
      ctl.settings = {
        status: 'ready',
        value: projectConfirmedSettings(result),
      };
      emitSettings(ctl, sessionId);
    },
    () => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.settings = {
        status: 'error',
        value: null,
        message: SETTINGS_READ_FAILED_MESSAGE,
      };
      emitSettings(ctl, sessionId);
    },
  );

  void runtime.readModelCatalog().then(
    (result) => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.modelCatalog = projectModelCatalog(result);
      emitModelCatalog(ctl, sessionId);
    },
    () => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.modelCatalog = {
        status: 'error',
        items: [],
        message: MODEL_CATALOG_FAILED_MESSAGE,
      };
      emitModelCatalog(ctl, sessionId);
    },
  );

  const contextStartedAt = performance.now();
  refreshContext(
    ctl,
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
  pushActivationSkills(ctl, activation);
  pushActivationMcp(ctl, activation);
}

/** Marks activation complete; context may have settled first. */
export function markSessionSwitchReady(
  ctl: ChatControllerInternals,
  timings: SessionSwitchTimings,
): void {
  timings.ready = true;
  recordSwitchTiming(ctl, timings);
}

function recordSwitchTiming(
  ctl: ChatControllerInternals,
  timings: SessionSwitchTimings,
): void {
  const event = finishSessionSwitchTiming(timings);
  if (event !== null) {
    ctl.recordHost(event);
  }
}
