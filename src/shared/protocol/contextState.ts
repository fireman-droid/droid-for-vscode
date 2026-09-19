export type SessionContextUnavailableReason =
  | 'unsupported'
  | 'awaiting-usage'
  | 'invalid-breakdown';

export type SessionContextStats = (
  | {
      readonly availability: 'available';
      /** Last-call usage and compaction threshold after the CLI meter's adjustment. */
      readonly used: number;
      readonly remaining: number;
      readonly limit: number;
    }
  | {
      readonly availability: 'unavailable';
      readonly reason: SessionContextUnavailableReason;
    }
) & {
  /** Character-based category estimate, never a compaction-meter input. */
  readonly estimatedTokens?: number;
};
