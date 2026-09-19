import {
  type AutonomyLevel,
  type AvailableModelConfig,
  type Base64ImageSource,
  type DocumentSource,
  type DroidInteractionMode,
  type DroidSessionUpdateSettingsOptions,
  type ReasoningEffort,
  type SessionSettings,
} from '@factory/droid-sdk/node';
import { isSafeModelId } from '../../shared/validation/guards';
import {
  MAX_RUNTIME_ATTACHMENTS,
  MAX_RUNTIME_IMAGE_BASE64_LENGTH,
  MAX_RUNTIME_MODEL_CATALOG_ITEMS,
  MAX_RUNTIME_MODEL_DISPLAY_NAME_LENGTH,
  MAX_RUNTIME_PDF_BASE64_LENGTH,
  MAX_RUNTIME_TEXT_ATTACHMENT_LENGTH,
  RUNTIME_AUTONOMY_LEVELS,
  RUNTIME_INTERACTION_MODES,
  RUNTIME_REASONING_EFFORTS,
  type RuntimeAttachment,
  type RuntimeModelCatalogItem,
  type RuntimeSessionSettingUpdate,
  type RuntimeSessionSettings,
  type RuntimeSessionWorkingState,
} from '../DroidRuntime';

export function projectSessionSettings(
  settings: Readonly<SessionSettings>,
): RuntimeSessionSettings {
  const interactionMode = projectEnum(
    settings.interactionMode,
    RUNTIME_INTERACTION_MODES,
  );
  const autonomyLevel = projectEnum(settings.autonomyLevel, RUNTIME_AUTONOMY_LEVELS);
  const reasoningEffort = projectEnum(
    settings.reasoningEffort,
    RUNTIME_REASONING_EFFORTS,
  );
  // Droid reports a reset spec field as absent (never null), so
  // undefined projects to null ("unset") here.
  const specModeModelId = settings.specModeModelId;
  const specModeReasoningEffort =
    settings.specModeReasoningEffort === undefined
      ? null
      : projectEnum(settings.specModeReasoningEffort, RUNTIME_REASONING_EFFORTS);
  if (
    interactionMode === undefined ||
    autonomyLevel === undefined ||
    reasoningEffort === undefined ||
    !isSafeModelId(settings.modelId) ||
    (specModeModelId !== undefined && !isSafeModelId(specModeModelId)) ||
    specModeReasoningEffort === undefined
  ) {
    throw new Error('Invalid session settings.');
  }

  return {
    interactionMode,
    modelId: settings.modelId,
    reasoningEffort,
    autonomyLevel,
    specModeModelId: specModeModelId ?? null,
    specModeReasoningEffort,
  };
}

export function projectModelCatalog(
  models: readonly AvailableModelConfig[],
): RuntimeModelCatalogItem[] {
  if (!Array.isArray(models) || models.length > MAX_RUNTIME_MODEL_CATALOG_ITEMS) {
    throw new Error('Invalid model catalog.');
  }
  const ids = new Set<string>();
  const projected = models.map((model) => {
    if (
      !isSafeModelId(model.id) ||
      ids.has(model.id) ||
      !isSafeModelDisplayName(model.displayName)
    ) {
      throw new Error('Invalid model catalog item.');
    }
    const efforts = model.supportedReasoningEfforts;
    if (
      !Array.isArray(efforts) ||
      efforts.length === 0 ||
      efforts.length > RUNTIME_REASONING_EFFORTS.length
    ) {
      throw new Error('Invalid model reasoning efforts.');
    }
    const projectedEfforts = efforts.map((effort) =>
      projectEnum(effort, RUNTIME_REASONING_EFFORTS),
    );
    if (
      projectedEfforts.some((effort) => effort === undefined) ||
      new Set(projectedEfforts).size !== projectedEfforts.length
    ) {
      throw new Error('Invalid model reasoning efforts.');
    }
    ids.add(model.id);
    return {
      isCustom: model.isCustom,
      item: {
        id: model.id,
        displayName: model.displayName,
        supportedReasoningEfforts:
          projectedEfforts as RuntimeModelCatalogItem['supportedReasoningEfforts'],
      },
    };
  });
  return projected.filter(({ isCustom }) => isCustom).map(({ item }) => item);
}

export function projectSettingsUpdate(
  update: RuntimeSessionSettingUpdate,
): DroidSessionUpdateSettingsOptions {
  if (
    typeof update !== 'object' ||
    update === null ||
    Reflect.ownKeys(update).length !== 2 ||
    !Object.hasOwn(update, 'field') ||
    !Object.hasOwn(update, 'value')
  ) {
    throw new Error('Invalid session setting update.');
  }

  switch (update.field) {
    case 'interactionMode':
      if (!isEnumValue(update.value, RUNTIME_INTERACTION_MODES)) {
        break;
      }
      return {
        interactionMode: update.value as DroidInteractionMode,
      };
    case 'modelId':
      if (!isSafeModelId(update.value)) {
        break;
      }
      return { modelId: update.value };
    case 'reasoningEffort':
      if (!isEnumValue(update.value, RUNTIME_REASONING_EFFORTS)) {
        break;
      }
      return {
        reasoningEffort: update.value as ReasoningEffort,
      };
    case 'autonomyLevel':
      if (!isEnumValue(update.value, RUNTIME_AUTONOMY_LEVELS)) {
        break;
      }
      return {
        autonomyLevel: update.value as AutonomyLevel,
      };
    case 'specModeModelId':
      // null resets Droid to drafting with the session model.
      if (update.value !== null && !isSafeModelId(update.value)) {
        break;
      }
      return { specModeModelId: update.value };
    case 'specModeReasoningEffort':
      if (
        update.value !== null &&
        !isEnumValue(update.value, RUNTIME_REASONING_EFFORTS)
      ) {
        break;
      }
      return {
        specModeReasoningEffort: update.value as ReasoningEffort | null,
      };
  }

  throw new Error('Invalid session setting update.');
}

export function projectEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | undefined {
  return isEnumValue(value, values) ? (value as Values[number]) : undefined;
}

export function isEnumValue(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}

export function isSafeModelDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RUNTIME_MODEL_DISPLAY_NAME_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/**
 * Projects the SDK's `DroidWorkingState` string onto the runtime enum.
 * Null (session no longer listed by the backend) and unrecognized
 * values both project to `unknown` so callers never mistake a lost
 * session or a new SDK state for an idle one.
 */
export function projectWorkingState(raw: string | null): RuntimeSessionWorkingState {
  switch (raw) {
    case 'idle':
      return 'idle';
    case 'waiting_for_tool_confirmation':
      return 'waiting-for-user';
    case 'thinking':
    case 'streaming_assistant_message':
    case 'executing_tool':
    case 'compacting_conversation':
      return 'running';
    default:
      return 'unknown';
  }
}

/**
 * Projects an SDK skill record to safe display fields, dropping
 * filesystem paths, raw content, and resources.
 */
/**
 * Maps validated runtime attachments onto the SDK stream options.
 * Oversized or excess attachments are rejected here so the SDK only
 * ever sees bounded payloads.
 */
export function projectStreamAttachments(
  attachments: readonly RuntimeAttachment[] | undefined,
): { images?: Base64ImageSource[]; files?: DocumentSource[] } {
  if (attachments === undefined || attachments.length === 0) {
    return {};
  }
  if (attachments.length > MAX_RUNTIME_ATTACHMENTS) {
    throw new Error('Too many attachments for one Droid turn.');
  }
  const images: Base64ImageSource[] = [];
  const files: DocumentSource[] = [];
  for (const attachment of attachments) {
    switch (attachment.kind) {
      case 'image':
        if (attachment.data.length > MAX_RUNTIME_IMAGE_BASE64_LENGTH) {
          throw new Error('Image attachment is too large.');
        }
        images.push({
          type: 'base64',
          data: attachment.data,
          mediaType: attachment.mediaType,
        });
        break;
      case 'pdf':
        if (attachment.data.length > MAX_RUNTIME_PDF_BASE64_LENGTH) {
          throw new Error('PDF attachment is too large.');
        }
        files.push({
          type: 'base64',
          mediaType: 'application/pdf',
          data: attachment.data,
          name: attachment.name,
        });
        break;
      case 'text':
        if (attachment.data.length > MAX_RUNTIME_TEXT_ATTACHMENT_LENGTH) {
          throw new Error('Text attachment is too large.');
        }
        files.push({
          type: 'text',
          mediaType: 'text/plain',
          data: attachment.data,
          name: attachment.name,
        });
        break;
    }
  }
  return {
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}
