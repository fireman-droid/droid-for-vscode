export class CustomModelState {
  readonly providerTests = new Map<
    string,
    {
      readonly status: 'passed' | 'failed';
      readonly summary: string;
      readonly latencyMs: number;
    }
  >();
  customModelsDiscoveryAbort: AbortController | null = null;
  customModelsOp = false;
}
