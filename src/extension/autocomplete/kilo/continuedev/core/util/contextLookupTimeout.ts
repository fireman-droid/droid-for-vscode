/** Optional language context shares one deadline per completion request. */
export const CONTEXT_LOOKUP_BUDGET_MS = 150;

export class ContextLookupTimeout extends Error {
  constructor() {
    super('Autocomplete language context exceeded its lookup budget.');
    this.name = 'ContextLookupTimeout';
  }
}
