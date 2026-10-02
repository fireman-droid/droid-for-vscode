import { createHash } from 'node:crypto';
import type { LoadedModel, ModelManagementGateway, SavedModel } from '../../runtime/models/modelManagement';
import { isCustomModelBaseUrl } from '../../shared/protocol/customModelsProtocol';
import { normalizeProviderRoot } from '../../shared/validation/providerEndpoint';
import { findLoadedModelIdentity } from './modelProjection';

const STORAGE_KEY = 'droidvisx.disabledModels.v1';
export const MODEL_DISABLED_MESSAGE = '此模型已禁用，请在模型管理中恢复启用或选择其他模型。';

export class ModelAvailabilityError extends Error {}

export class ModelDisabledError extends ModelAvailabilityError {
  constructor() { super(MODEL_DISABLED_MESSAGE); }
}

export interface ModelAvailability {
  projectCatalog<T extends { readonly id: string }>(items: readonly T[]): Promise<readonly T[]>;
  assertEnabled(modelId: string): Promise<void>;
}

interface PreferenceStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** User-owned GUI availability; Droid configurations and credentials stay intact. */
export class DisabledModelsStore implements ModelAvailability {
  private readonly listeners = new Set<() => void>();
  private pendingWrite = Promise.resolve();

  constructor(
    private readonly store: PreferenceStore,
    private readonly gateway: Pick<ModelManagementGateway, 'list' | 'loaded'>,
  ) {}

  isDisabled(row: SavedModel): boolean {
    const key = modelKey(row);
    return key !== null && this.read().has(key);
  }

  async setDisabled(row: SavedModel, disabled: boolean): Promise<void> {
    const key = modelKey(row);
    if (key === null) throw new ModelAvailabilityError('无法识别此模型的接口配置，请刷新后重试。');
    if (disabled) {
      const [rows, loaded] = await Promise.all([this.gateway.list(), this.gateway.loaded()]);
      const current = rows.find((item) => modelKey(item) === key);
      if (!current) throw new ModelAvailabilityError('模型配置已变化，请刷新后重试。');
      resolveRuntimeIdentity(current, loaded, rows);
    }
    return this.update((keys) => { if (disabled) keys.add(key); else keys.delete(key); });
  }

  move(previous: SavedModel, next: SavedModel): Promise<void> {
    const previousKey = modelKey(previous);
    const nextKey = modelKey(next);
    if (previousKey === null || nextKey === null || previousKey === nextKey) return Promise.resolve();
    return this.update((keys) => {
      if (keys.delete(previousKey)) keys.add(nextKey);
    });
  }

  forget(row: SavedModel): Promise<void> {
    const key = modelKey(row);
    return key === null ? Promise.resolve() : this.update((keys) => { keys.delete(key); });
  }

  subscribe(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  refresh(): void { for (const listener of this.listeners) listener(); }

  async disabledRuntimeIds(): Promise<ReadonlySet<string>> {
    if (this.read().size === 0) return new Set();
    const [rows, loaded] = await Promise.all([this.gateway.list(), this.gateway.loaded()]);
    const disabled = new Set<string>();
    for (const row of rows) {
      if (!this.isDisabled(row)) continue;
      const runtimeId = resolveRuntimeIdentity(row, loaded, rows);
      if (runtimeId !== null) disabled.add(runtimeId);
    }
    return disabled;
  }

  async projectCatalog<T extends { readonly id: string }>(items: readonly T[]): Promise<readonly T[]> {
    if (this.read().size === 0) return items;
    const disabled = await this.disabledRuntimeIds();
    return items.filter((item) => !disabled.has(item.id));
  }

  async assertEnabled(modelId: string): Promise<void> {
    if (this.read().size === 0) return;
    if ((await this.disabledRuntimeIds()).has(modelId)) throw new ModelDisabledError();
  }

  private read(): Set<string> {
    const value = this.store.get<unknown>(STORAGE_KEY);
    return new Set(Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && /^[a-f0-9]{64}$/u.test(entry))
      : []);
  }

  private update(change: (keys: Set<string>) => void): Promise<void> {
    const write = this.pendingWrite.then(async () => {
      const keys = this.read();
      const before = JSON.stringify([...keys].sort());
      change(keys);
      const after = [...keys].sort();
      if (JSON.stringify(after) === before) return;
      await this.store.update(STORAGE_KEY, after);
      this.refresh();
    });
    this.pendingWrite = write.catch(() => undefined);
    return write;
  }
}

function resolveRuntimeIdentity(row: SavedModel, loaded: readonly LoadedModel[], rows: readonly SavedModel[]): string | null {
  const identity = findLoadedModelIdentity(row, loaded, rows);
  if (identity.runtimeId === null && loaded.some((model) => model.displayName === (row.displayName ?? row.model))) {
    throw new ModelAvailabilityError('无法确认此模型所属的运行时渠道。请刷新模型列表，并为同名模型设置不同别名后重试。');
  }
  return identity.runtimeId;
}

function modelKey(row: SavedModel): string | null {
  if (typeof row.baseUrl !== 'string' || !isCustomModelBaseUrl(row.baseUrl)) return null;
  return createHash('sha256').update(JSON.stringify([
    row.provider, normalizeProviderRoot(row.baseUrl), row.model,
  ])).digest('hex');
}
