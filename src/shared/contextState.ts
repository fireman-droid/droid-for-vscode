export type SessionContextUnavailableReason =
  | 'no-last-call'
  | 'invalid-last-call'
  | 'invalid-budget';

export type SessionContextStats =
  | {
      readonly availability: 'available';
      readonly used: number;
      readonly remaining: number;
      readonly limit: number;
      readonly compactionDetected?: true;
    }
  | {
      readonly availability: 'unavailable';
      readonly reason: SessionContextUnavailableReason;
    };
