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

  cancelDiscovery(): void {
    if (this.customModelsDiscoveryAbort === null) return;
    this.customModelsDiscoveryAbort.abort();
    this.customModelsDiscoveryAbort = null;
    this.customModelsOp = false;
  }
}
