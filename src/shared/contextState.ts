export type SessionContextUnavailableReason =
  | 'unsupported'
  | 'invalid-breakdown';

export type SessionContextStats =
  | {
      readonly availability: 'available';
      readonly used: number;
      readonly remaining: number;
      readonly limit: number;
    }
  | {
      readonly availability: 'unavailable';
      readonly reason: SessionContextUnavailableReason;
    };
