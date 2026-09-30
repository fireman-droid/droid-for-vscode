import {
  CUSTOM_MODEL_PROVIDERS,
  isCustomModelBaseUrl,
  type CustomModelProvider,
} from '../../shared/protocol/customModelsProtocol';
import type {
  ManagedModel,
  ModelConnection,
  ModelVerification,
} from '../../shared/protocol/modelManagerProtocol';
import { normalizeProviderRoot } from '../../shared/validation/providerEndpoint';
import type { LoadedModel, SavedModel } from '../../runtime/models/modelManagement';
import type { ProviderRegistry } from '../chat/models/providerRegistry';

/** Unlike legacy grouping, explicit /v1 and /anthropic paths are distinct endpoints. */
export function connectionKey(protocol: string, baseUrl: string): string {
  return `${protocol}\n${normalizeProviderRoot(baseUrl)}`;
}

export async function projectConnections(
  registry: ProviderRegistry,
  rows: readonly SavedModel[],
): Promise<ModelConnection[]> {
  const connections: ModelConnection[] = await Promise.all(
    registry.list().map(async (row) => ({
      id: row.id,
      name: row.displayName,
      protocol: row.protocol,
      baseUrl: row.rootUrl,
      hasKey: await registry.hasApiKey(row.id),
      imported: false,
      ...(registry.providerName(row.rootUrl) ? { providerName: registry.providerName(row.rootUrl) } : {}),
    })),
  );
  const known = new Set(
    connections.map((row) => connectionKey(row.protocol, row.baseUrl)),
  );
  for (const row of rows) {
    if (
      !(CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(row.provider) ||
      typeof row.baseUrl !== 'string' ||
      !isCustomModelBaseUrl(row.baseUrl)
    )
      continue;
    const key = connectionKey(row.provider, row.baseUrl);
    if (known.has(key)) continue;
    known.add(key);
    connections.push({
      id: `imported:${row.rawIndex}`,
      name: new URL(row.baseUrl).host,
      protocol: row.provider as CustomModelProvider,
      baseUrl: row.baseUrl,
      hasKey: (await registry.apiKeyForEndpoint(row.provider as CustomModelProvider, row.baseUrl)) !== undefined || rows.some(
        (item) =>
          typeof item.baseUrl === 'string' &&
          isCustomModelBaseUrl(item.baseUrl) &&
          connectionKey(item.provider, item.baseUrl) === key &&
          item.hasApiKey,
      ),
      imported: true,
      ...(registry.providerName(row.baseUrl) ? { providerName: registry.providerName(row.baseUrl) } : {}),
    });
  }
  return connections;
}

export function findLoadedModel(
  row: SavedModel,
  loaded: readonly LoadedModel[],
  rows: readonly SavedModel[],
): { readonly runtimeId: string | null; readonly loadMessage: string } {
  if (!row.isValid)
    return { runtimeId: null, loadMessage: 'Droid marked this configuration invalid.' };
  const name = row.displayName ?? row.model;
  const matches = loaded.filter((model) => model.displayName === name);
  if (
    matches.length > 1 ||
    rows.filter((item) => (item.displayName ?? item.model) === name).length !== 1
  )
    return {
      runtimeId: null,
      loadMessage:
        'Multiple Droid models share this display name. Give this model a unique display name.',
    };
  const match = matches[0];
  if (match === undefined)
    return {
      runtimeId: null,
      loadMessage:
        'Saved, but not present in Droid’s model catalog. Refresh to check again.',
    };
  if (match.disabledReason !== null)
    return {
      runtimeId: null,
      loadMessage: match.disabledReason,
    };
  if (match.provider !== row.provider)
    return {
      runtimeId: null,
      loadMessage:
        'The Droid catalog still has a different protocol for this name. Refresh after correcting the configuration.',
    };
  return { runtimeId: match.id, loadMessage: 'Loaded by Droid' };
}

export function projectManagedModels(
  rows: readonly SavedModel[],
  connections: readonly ModelConnection[],
  loaded: readonly LoadedModel[],
  tests: ReadonlyMap<string, ModelVerification>,
): ManagedModel[] {
  return rows.flatMap((row) => {
    const connection = !isCustomModelBaseUrl(row.baseUrl)
      ? undefined
      : connections.find(
          (item) =>
            connectionKey(item.protocol, item.baseUrl) ===
            connectionKey(row.provider, row.baseUrl!),
        );
    if (connection === undefined) return [];
    return [
      {
        rawIndex: row.rawIndex,
        model: row.model,
        displayName: row.displayName ?? row.model,
        connectionId: connection.id,
        maxOutputTokens: row.maxOutputTokens ?? null,
        noImageSupport: row.noImageSupport ?? false,
        valid: row.isValid,
        ...findLoadedModel(row, loaded, rows),
        test: tests.get(modelRevision(row)) ?? null,
      },
    ];
  });
}

/** Associate local results with the configuration fields exposed by the daemon. */
export function modelRevision(row: SavedModel): string {
  return JSON.stringify(row);
}
