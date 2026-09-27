import { type DroidSessionUpdateSettingsOptions } from '@factory/droid-sdk/node';
import {
  projectContextWindow,
  type FactoryContextBreakdown,
} from '../capabilities/contextWindow';
import {
  type RuntimeContextWindow,
  type RuntimeModelCatalog,
  type RuntimeSessionSettingUpdate,
  type RuntimeSessionSettings,
  type RuntimeSessionWorkingState,
} from '../DroidRuntime';
import type { RuntimeDiagnosticSink } from '../runtimeDiagnostics';
import {
  projectModelCatalog,
  projectSessionSettings,
  projectSettingsUpdate,
  projectWorkingState,
} from './projections';
import type { FactoryDroidSession } from './sessionTypes';
export interface MetadataContext {
  readonly session: FactoryDroidSession;
  recordDiagnostic(event: Parameters<RuntimeDiagnosticSink['record']>[0]): void;
}

export async function readSessionSettings(
  context: MetadataContext,
): Promise<RuntimeSessionSettings> {
  const session = context.session;
  try {
    return projectSessionSettings(session.settings);
  } catch {
    throw new Error('Droid returned invalid session settings.');
  }
}

export function readMissionSettings(
  context: MetadataContext,
): import('../DroidRuntime').RuntimeMissionSettings | null {
  const settings = context.session.settings.missionSettings;
  if (
    settings === null ||
    typeof settings !== 'object' ||
    Array.isArray(settings) ||
    !('skipScrutiny' in settings) ||
    typeof settings.skipScrutiny !== 'boolean' ||
    !('skipUserTesting' in settings) ||
    typeof settings.skipUserTesting !== 'boolean'
  ) {
    return null;
  }
  return {
    scrutinyEnabled: !settings.skipScrutiny,
    userTestingEnabled: !settings.skipUserTesting,
  };
}

export async function readModelCatalog(
  context: MetadataContext,
): Promise<RuntimeModelCatalog> {
  let models: FactoryDroidSession['availableModels'];
  try {
    models = context.session.readAvailableModels
      ? await context.session.readAvailableModels()
      : context.session.availableModels;
  } catch {
    context.recordDiagnostic({ level: 'error', name: 'runtime.models.read-failed' });
    throw new Error('Droid model catalog could not be loaded.');
  }
  if (models === undefined) {
    return { status: 'unavailable' };
  }
  try {
    return {
      status: 'available',
      items: projectModelCatalog(models),
    };
  } catch {
    throw new Error('Droid returned an invalid model catalog.');
  }
}

export async function updateSessionSetting(
  context: MetadataContext,
  update: RuntimeSessionSettingUpdate,
): Promise<RuntimeSessionSettings> {
  const session = context.session;
  let params: DroidSessionUpdateSettingsOptions;
  try {
    params = projectSettingsUpdate(update);
  } catch {
    throw new Error('Invalid session setting update.');
  }
  try {
    await session.updateSettings(params);
    return projectSessionSettings(session.settings);
  } catch {
    throw new Error('Droid session settings could not be updated.');
  }
}

export async function readSessionWorkingState(
  context: MetadataContext,
): Promise<RuntimeSessionWorkingState> {
  const session = context.session;
  if (typeof session.readWorkingState !== 'function') {
    throw new Error('The Droid session does not report a working state.');
  }
  return projectWorkingState(await session.readWorkingState());
}

export async function readContextWindow(
  context: MetadataContext,
): Promise<RuntimeContextWindow> {
  const session = context.session;
  const startedAt = performance.now();
  context.recordDiagnostic({
    level: 'debug',
    name: 'runtime.context.started',
  });
  if (typeof session.readContextBreakdown !== 'function') {
    const result: RuntimeContextWindow = {
      availability: 'unavailable',
      reason: 'unsupported',
    };
    context.recordDiagnostic({
      level: 'info',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: result.availability,
        reason: result.reason,
      },
    });
    return result;
  }
  let breakdown: FactoryContextBreakdown;
  try {
    breakdown = await session.readContextBreakdown();
  } catch {
    context.recordDiagnostic({
      level: 'error',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'sdk-error',
      },
    });
    throw new Error('Droid context statistics could not be read.');
  }
  const result = projectContextWindow(breakdown);
  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.context.finished',
    attributes: {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: result.availability,
      ...(result.availability === 'available'
        ? {
            source: 'context-breakdown',
            used: result.used,
            remaining: result.remaining,
            limit: result.limit,
          }
        : { reason: result.reason }),
    },
  });
  return result;
}
