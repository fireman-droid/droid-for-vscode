import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const MODEL_SOURCE_VERSION = 1 as const;
export type ModelSourceMode = 'official' | 'byok' | 'mixed';
export type ModelSourceRequest =
  | { readonly type: 'ui.modelSource.read'; readonly version: typeof MODEL_SOURCE_VERSION }
  | { readonly type: 'ui.modelSource.set'; readonly version: typeof MODEL_SOURCE_VERSION; readonly mode: ModelSourceMode };
export interface ModelSourceState {
  readonly type: 'ui.modelSource.state';
  readonly version: typeof MODEL_SOURCE_VERSION;
  readonly mode: ModelSourceMode;
  readonly error?: string;
}

export function isModelSourceMode(value: unknown): value is ModelSourceMode {
  return value === 'official' || value === 'byok' || value === 'mixed';
}

export function parseModelSourceRequest(value: unknown): ModelSourceRequest | null {
  if (!isStrictRecord(value) || value.version !== MODEL_SOURCE_VERSION) return null;
  if (value.type === 'ui.modelSource.read' && hasExactKeys(value, ['type', 'version']))
    return { type: value.type, version: MODEL_SOURCE_VERSION };
  if (value.type === 'ui.modelSource.set' && hasExactKeys(value, ['type', 'version', 'mode']) && isModelSourceMode(value.mode))
    return { type: value.type, version: MODEL_SOURCE_VERSION, mode: value.mode };
  return null;
}

export function parseModelSourceState(value: unknown): ModelSourceState | null {
  if (!isStrictRecord(value) || value.type !== 'ui.modelSource.state' || value.version !== MODEL_SOURCE_VERSION ||
      !hasExactKeys(value, ['type', 'version', 'mode'], ['error']) || !isModelSourceMode(value.mode) ||
      value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 512)) return null;
  return { type: value.type, version: MODEL_SOURCE_VERSION, mode: value.mode,
    ...(value.error === undefined ? {} : { error: value.error }) };
}

export function matchesModelSource(model: { readonly id: string; readonly isCustom?: boolean }, mode: ModelSourceMode): boolean {
  if (mode === 'mixed') return true;
  return mode === 'byok' ? model.isCustom === true : model.isCustom === false;
}
