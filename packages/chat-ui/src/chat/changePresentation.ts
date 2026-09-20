export interface ChangeFile {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly kind?: string;
}
