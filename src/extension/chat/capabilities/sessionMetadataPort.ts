import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';

export interface SessionMetadataPort
  extends Pick<HostOperations, 'isCurrentSessionOperation' | 'metadata' | 'recordHost'> {
  readonly effects: Pick<
    ChatEffects,
    | 'emitSettings'
    | 'emitModelCatalog'
    | 'refreshContext'
    | 'pushActivationSkills'
    | 'pushActivationMcp'
  >;
}
