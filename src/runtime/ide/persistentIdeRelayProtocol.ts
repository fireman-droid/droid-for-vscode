import type { NativeIdeRelayState } from './nativeIdeRelay';

/** Private loopback capability; never include this descriptor in diagnostics. */
export interface PersistentIdeRelayDescriptor {
  readonly port: number;
  readonly pid: number;
  readonly token: string;
}

export interface PersistentIdeRelaySnapshot {
  readonly sessionId: string;
  readonly port: number;
  readonly state: NativeIdeRelayState;
  readonly requiresRestart: boolean;
}

export function isRelayDescriptor(value: unknown): value is PersistentIdeRelayDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Partial<PersistentIdeRelayDescriptor>;
  return Number.isInteger(descriptor.port) && descriptor.port! > 0 && descriptor.port! <= 65535
    && Number.isInteger(descriptor.pid) && descriptor.pid! > 0
    && typeof descriptor.token === 'string' && /^[a-f0-9]{64}$/u.test(descriptor.token);
}
