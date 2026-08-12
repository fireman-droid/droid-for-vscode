// settings: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  ConfirmedSessionSettings,
  SessionSettingUpdateMessage,
} from '../../shared/bridgeMessages';
import {
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeSessionSettings,
  RuntimeSessionSettingUpdate,
} from '../../runtime/DroidRuntime';
import { isSafeModelId } from './capabilityPanels';
import { ensureActiveRuntimeWorkspaceCurrent } from './runtimeLifecycle';
import { isEnumValue, type ChatControllerInternals } from './internals';

export const SETTINGS_READ_FAILED_MESSAGE =
  'Droid session settings could not be loaded.';

export const SETTINGS_UPDATE_FAILED_MESSAGE =
  'Droid session settings could not be updated.';

export const SETTINGS_UPDATE_BLOCKED_MESSAGE =
  'Finish the current interaction or setting update before changing settings.';

export const SETTINGS_UPDATE_UNSUPPORTED_MESSAGE =
  'This setting is not available for the current Droid session.';

export function handleSettingUpdate(
  ctl: ChatControllerInternals,
    message: SessionSettingUpdateMessage,
  ): void {
    const runtime = ctl.runtime;
    const cwd = ctl.activeRuntimeCwd;
    if (
      runtime === null ||
      cwd === null ||
      message.sessionId !== ctl.sessionId ||
      ctl.connection.status !== 'connected' ||
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      ctl.interactions.hasPending() ||
      ctl.sessionOperationInProgress ||
      ctl.settingsUpdate !== null ||
      ctl.settings.status === 'loading' ||
      ctl.settings.status === 'updating' ||
      ctl.settings.value === null
    ) {
      ctl.emitSessionDiagnostic(
        'settings-update-blocked',
        SETTINGS_UPDATE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (!isSettingUpdateSupported(ctl, message)) {
      ctl.emitSessionDiagnostic(
        'settings-update-unsupported',
        SETTINGS_UPDATE_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    const operation = Symbol('settings-update');
    const generation = ctl.runtimeGeneration;
    const confirmed = ctl.settings.value;
    ctl.settingsUpdate = operation;
    ctl.settings = { status: 'updating', value: confirmed };
    emitSettings(ctl, message.sessionId);
    const update: RuntimeSessionSettingUpdate = {
      field: message.field,
      value: message.value,
    } as RuntimeSessionSettingUpdate;
    void runtime
      .updateSessionSetting(update)
      .then((result) => {
        if (
          !isCurrentSettingsUpdate(ctl, 
            runtime,
            generation,
            message.sessionId,
            cwd,
            operation,
          )
        ) {
          return;
        }
        ctl.settings = {
          status: 'ready',
          value: projectConfirmedSettings(result),
        };
        emitSettings(ctl, message.sessionId);
      })
      .catch(() => {
        if (
          !isCurrentSettingsUpdate(ctl, 
            runtime,
            generation,
            message.sessionId,
            cwd,
            operation,
          )
        ) {
          return;
        }
        ctl.settings = {
          status: 'error',
          value: confirmed,
          message: SETTINGS_UPDATE_FAILED_MESSAGE,
        };
        emitSettings(ctl, message.sessionId);
      })
      .finally(() => {
        if (ctl.settingsUpdate === operation) {
          ctl.settingsUpdate = null;
        }
      });
}

export function isSettingUpdateSupported(
  ctl: ChatControllerInternals,
    message: SessionSettingUpdateMessage,
  ): boolean {
    if (
      message.field === 'interactionMode' ||
      message.field === 'autonomyLevel'
    ) {
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
    const settings = ctl.settings.value;
    if (
      ctl.modelCatalog.status !== 'ready' ||
      settings === null
    ) {
      return false;
    }
    if (
      message.field === 'modelId' ||
      message.field === 'specModeModelId'
    ) {
      return ctl.modelCatalog.items.some(
        ({ id }) => id === message.value,
      );
    }
    // Reasoning effort must be supported by the model it applies to:
    // the spec drafting model for spec efforts (falling back to the
    // session model when no spec model is set).
    const targetModelId =
      message.field === 'specModeReasoningEffort'
        ? (settings.specModeModelId ?? settings.modelId)
        : settings.modelId;
    const model = ctl.modelCatalog.items.find(
      ({ id }) => id === targetModelId,
    );
    return (
      model !== undefined &&
      message.value !== null &&
      model.supportedReasoningEfforts.includes(message.value)
    );
}

export function emitSettings(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    ctl.emit({
      type: 'session.settings',
      sessionId,
      settings: ctl.settings,
    });
}

export function isCurrentSettingsUpdate(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
    operation: symbol,
  ): boolean {
    return (
      ctl.settingsUpdate === operation &&
      ctl.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    );
}

export function refreshSettingsAfterRuntimeEvent(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    const cwd = ctl.activeRuntimeCwd;
    if (
      runtime === null ||
      cwd === null ||
      ctl.sessionId !== sessionId ||
      ctl.connection.status !== 'connected'
    ) {
      return;
    }
    const generation = ctl.runtimeGeneration;
    const confirmed = ctl.settings.value;
    void runtime
      .readSessionSettings()
      .then((result) => {
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.settings = {
          status: 'ready',
          value: projectConfirmedSettings(result),
        };
        emitSettings(ctl, sessionId);
      })
      .catch(() => {
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.settings = {
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
    (settings.specModeModelId !== null &&
      !isSafeModelId(settings.specModeModelId)) ||
    (settings.specModeReasoningEffort !== null &&
      !isEnumValue(
        settings.specModeReasoningEffort,
        SESSION_REASONING_EFFORTS,
      ))
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
