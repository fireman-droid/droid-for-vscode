import type { SettingsHostPort } from './metadataPorts';
import { ModelAvailabilityError } from '../../models/DisabledModelsStore';
import {
  type ConfirmedSessionSettings,
  type SessionSettingUpdateMessage,
} from '../../../shared/protocol/settings';
import {
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../../../shared/protocol/bounds';
import type {
  DroidRuntime,
  RuntimeSessionSettings,
  RuntimeSessionSettingUpdate,
} from '../../../runtime/DroidRuntime';
import { isSafeModelId } from '../../../shared/validation/guards';
import { isEnumValue } from '../internals';

export const SETTINGS_READ_FAILED_MESSAGE = 'Droid session settings could not be loaded.';

export const SETTINGS_UPDATE_FAILED_MESSAGE =
  'Droid session settings could not be updated.';

export const SETTINGS_UPDATE_BLOCKED_MESSAGE =
  'Finish the current interaction or setting update before changing settings.';

export const SETTINGS_UPDATE_UNSUPPORTED_MESSAGE =
  'This setting is not available for the current Droid session.';

export function handleSettingUpdate(
  ctl: SettingsHostPort,
  message: SessionSettingUpdateMessage,
): void {
  const runtime = ctl.sessionState.runtime;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (
    runtime === null ||
    cwd === null ||
    message.sessionId !== ctl.sessionState.sessionId ||
    ctl.sessionState.connection.status !== 'connected' ||
    !ctl.ensureWorkspaceCurrent()
  ) {
    return;
  }
  if (
    ctl.hasPendingInteractions() ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.metadata.settingsUpdate !== null ||
    ctl.metadata.settings.status === 'loading' ||
    ctl.metadata.settings.status === 'updating' ||
    ctl.metadata.settings.value === null
  ) {
    ctl.emitSessionDiagnostic('settings-update-blocked', SETTINGS_UPDATE_BLOCKED_MESSAGE);
    return;
  }
  if (!isSettingUpdateSupported(ctl, message)) {
    const selectedId = message.field === 'modelId' || message.field === 'specModeModelId'
      ? message.value : message.field === 'specModeReasoningEffort'
        ? ctl.metadata.settings.value?.specModeModelId ?? ctl.metadata.settings.value?.modelId
        : ctl.metadata.settings.value?.modelId;
    const model = ctl.metadata.modelCatalog.items.find((item) => item.id === selectedId);
    ctl.emitSessionDiagnostic(
      'settings-update-unsupported',
      model?.disabled ? model.disabledReason! : SETTINGS_UPDATE_UNSUPPORTED_MESSAGE,
    );
    return;
  }

  const operation = Symbol('settings-update');
  const generation = ctl.sessionState.runtimeGeneration;
  const confirmed = ctl.metadata.settings.value;
  ctl.metadata.settingsUpdate = operation;
  ctl.metadata.settings = { status: 'updating', value: confirmed };
  emitSettings(ctl, message.sessionId);
  const update: RuntimeSessionSettingUpdate = {
    field: message.field,
    value: message.value,
  } as RuntimeSessionSettingUpdate;
  const selectedModel = (message.field === 'modelId' || message.field === 'specModeModelId') ? message.value : null;
  void Promise.resolve(selectedModel === null ? undefined : ctl.modelAvailability?.assertEnabled(selectedModel))
    .then(() => {
      if (!isCurrentSettingsUpdate(ctl, runtime, generation, message.sessionId, cwd, operation)) return confirmed;
      return runtime.updateSessionSetting(update);
    })
    .then((result) => {
      if (
        !isCurrentSettingsUpdate(
          ctl,
          runtime,
          generation,
          message.sessionId,
          cwd,
          operation,
        )
      ) {
        return;
      }
      ctl.metadata.settings = {
        status: 'ready',
        value: projectConfirmedSettings(result),
      };
      emitSettings(ctl, message.sessionId);
    })
    .catch((error: unknown) => {
      if (
        !isCurrentSettingsUpdate(
          ctl,
          runtime,
          generation,
          message.sessionId,
          cwd,
          operation,
        )
      ) {
        return;
      }
      ctl.metadata.settings = {
        status: 'error',
        value: confirmed,
        message: error instanceof ModelAvailabilityError ? error.message : SETTINGS_UPDATE_FAILED_MESSAGE,
      };
      emitSettings(ctl, message.sessionId);
    })
    .finally(() => {
      if (ctl.metadata.settingsUpdate === operation) {
        ctl.metadata.settingsUpdate = null;
      }
    });
}

export function isSettingUpdateSupported(
  ctl: SettingsHostPort,
  message: SessionSettingUpdateMessage,
): boolean {
  if (message.field === 'interactionMode' || message.field === 'autonomyLevel') {
    return true;
  }
  if (
    (message.field === 'specModeModelId' ||
      message.field === 'specModeReasoningEffort') &&
    message.value === null
  ) {
    // Resetting a spec override needs no catalog knowledge.
    return true;
  }
  const settings = ctl.metadata.settings.value;
  if (ctl.metadata.modelCatalog.status !== 'ready' || settings === null) {
    return false;
  }
  if (message.field === 'modelId' || message.field === 'specModeModelId') {
    return ctl.metadata.modelCatalog.items.some(({ id, disabled }) => id === message.value && !disabled);
  }
  // Reasoning effort must be supported by the model it applies to:
  // the spec drafting model for spec efforts (falling back to the
  // session model when no spec model is set).
  const targetModelId =
    message.field === 'specModeReasoningEffort'
      ? (settings.specModeModelId ?? settings.modelId)
      : settings.modelId;
  const model = ctl.metadata.modelCatalog.items.find(({ id }) => id === targetModelId);
  return (
    model !== undefined &&
    !model.disabled &&
    message.value !== null &&
    model.supportedReasoningEfforts.includes(message.value)
  );
}

export function emitSettings(ctl: SettingsHostPort, sessionId: string): void {
  ctl.emit({
    type: 'session.settings',
    sessionId,
    settings: ctl.metadata.settings,
  });
  ctl.metadataChanged();
}

export function isCurrentSettingsUpdate(
  ctl: SettingsHostPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
  operation: symbol,
): boolean {
  return (
    ctl.metadata.settingsUpdate === operation &&
    ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
  );
}

export function refreshSettingsAfterRuntimeEvent(
  ctl: SettingsHostPort,
  sessionId: string,
): void {
  const runtime = ctl.sessionState.runtime;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (
    runtime === null ||
    cwd === null ||
    ctl.sessionState.sessionId !== sessionId ||
    ctl.sessionState.connection.status !== 'connected'
  ) {
    return;
  }
  const generation = ctl.sessionState.runtimeGeneration;
  const confirmed = ctl.metadata.settings.value;
  void runtime
    .readSessionSettings()
    .then((result) => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.settings = {
        status: 'ready',
        value: projectConfirmedSettings(result),
      };
      emitSettings(ctl, sessionId);
    })
    .catch(() => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.metadata.settings = {
        status: 'error',
        value: confirmed,
        message: SETTINGS_READ_FAILED_MESSAGE,
      };
      emitSettings(ctl, sessionId);
    });
}

export function projectConfirmedSettings(
  settings: RuntimeSessionSettings,
): ConfirmedSessionSettings {
  if (
    !isEnumValue(settings.interactionMode, SESSION_INTERACTION_MODES) ||
    !isSafeModelId(settings.modelId) ||
    !isEnumValue(settings.reasoningEffort, SESSION_REASONING_EFFORTS) ||
    !isEnumValue(settings.autonomyLevel, SESSION_AUTONOMY_LEVELS) ||
    (settings.specModeModelId !== null && !isSafeModelId(settings.specModeModelId)) ||
    (settings.specModeReasoningEffort !== null &&
      !isEnumValue(settings.specModeReasoningEffort, SESSION_REASONING_EFFORTS))
  ) {
    throw new Error('Invalid runtime session settings.');
  }
  return {
    interactionMode: settings.interactionMode,
    modelId: settings.modelId,
    reasoningEffort: settings.reasoningEffort,
    autonomyLevel: settings.autonomyLevel,
    specModeModelId: settings.specModeModelId,
    specModeReasoningEffort: settings.specModeReasoningEffort,
  };
}
