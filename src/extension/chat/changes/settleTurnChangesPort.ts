import type { HostOperations } from '../hostOperations';

export interface SettleTurnChangesPort
  extends Pick<HostOperations, 'turnSnapshots' | 'changeStats'> {
  readonly recordHost?: HostOperations['recordHost'];
}
