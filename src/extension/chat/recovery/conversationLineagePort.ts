import type { HostOperations } from '../hostOperations';

export interface ConversationLineagePort extends Pick<HostOperations, 'recoveryStore'> {}
