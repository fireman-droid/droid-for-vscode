export interface SyntaxDocument {
  readonly text: string;
  /** Zero-based source lines to return; omitted for a complete code block. */
  readonly lines?: readonly number[];
}
export interface SyntaxRequest {
  readonly id: number;
  readonly documents: readonly SyntaxDocument[];
  readonly language?: string | null;
  readonly path?: string;
}
export interface SyntaxResponse {
  readonly id: number;
  readonly documents: readonly Readonly<Record<number, string>>[];
  readonly error?: string;
}
export interface DiffSyntaxSource { readonly before: string; readonly after: string }
export type SyntaxWorkerFactory = () => Promise<Worker>;
