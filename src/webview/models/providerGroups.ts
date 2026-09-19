import type { ModelConnection, ModelsSnapshot } from '../../shared/protocol/modelManagerProtocol';

export interface ModelProviderGroup {
  readonly host: string;
  readonly name: string;
  readonly connections: readonly ModelConnection[];
  readonly modelCount: number;
}

/** Group presentation only. Protocol, full URL and credentials remain independent. */
export function groupModelProviders(snapshot: ModelsSnapshot | null): ModelProviderGroup[] {
  const groups = new Map<string, ModelConnection[]>();
  for (const connection of snapshot?.connections ?? []) {
    const host = new URL(connection.baseUrl).host;
    const connections = groups.get(host) ?? [];
    connections.push(connection);
    groups.set(host, connections);
  }
  return [...groups].map(([host, connections]) => {
    return {
      host,
      name: connections.find((connection) => connection.providerName)?.providerName ??
        (host === 'api.deepseek.com' ? 'DeepSeek' : host),
      connections,
      modelCount: snapshot?.models.filter((model) => connections.some((connection) => connection.id === model.connectionId)).length ?? 0,
    };
  });
}
