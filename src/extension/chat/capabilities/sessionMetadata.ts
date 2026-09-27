import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { ModelCatalogState } from '../../../shared/protocol/settings';
import { MODEL_CATALOG_FAILED_MESSAGE, projectModelCatalog } from './capabilityPanels';
import type { CapabilitiesHostPort } from './metadataPorts';
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

  void refreshModelCatalog(ctl, runtime, generation, sessionId, cwd);

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

export function handleModelCatalogRefresh(
  ctl: SessionMetadataPort & Pick<CapabilitiesHostPort, 'sessionState' | 'ensureWorkspaceCurrent'>,
  sessionId: string,
): void {
  const { runtime, runtimeGeneration, activeRuntimeCwd, connection, sessionOperationInProgress } = ctl.sessionState;
  if (sessionId !== ctl.sessionState.sessionId || runtime === null || activeRuntimeCwd === null ||
      connection.status !== 'connected' || sessionOperationInProgress ||
      ctl.metadata.modelCatalog.status === 'loading' || !ctl.ensureWorkspaceCurrent()) return;
  void refreshModelCatalog(ctl, runtime, runtimeGeneration, sessionId, activeRuntimeCwd);
}

/** Startup and explicit retry share the same catalog read and session ownership. */
async function refreshModelCatalog(
  ctl: SessionMetadataPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
): Promise<void> {
  const loading = { status: 'loading', items: [] } as const;
  ctl.metadata.modelCatalog = loading;
  ctl.effects.emitModelCatalog(sessionId);
  let catalog: ModelCatalogState;
  try {
    catalog = projectModelCatalog(await runtime.readModelCatalog());
  } catch {
    catalog = { status: 'error', items: [], message: MODEL_CATALOG_FAILED_MESSAGE };
  }
  if (ctl.metadata.modelCatalog !== loading ||
      !ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return;
  ctl.metadata.modelCatalog = catalog;
  if (catalog.status === 'error') {
    ctl.recordHost({ level: 'warn', name: 'host.model-catalog.read-failed', attributes: { sessionId } });
  }
  ctl.effects.emitModelCatalog(sessionId);
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
