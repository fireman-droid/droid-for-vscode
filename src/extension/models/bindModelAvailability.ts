import type { ChatController } from '../chat/ChatController';
import { handleModelCatalogRefresh } from '../chat/capabilities/sessionMetadata';
import type { DisabledModelsStore } from './DisabledModelsStore';

/** Share user preferences with each chat without replacing its live session. */
export function bindModelAvailability(controller: ChatController, availability: DisabledModelsStore): { dispose(): void } {
  controller.modelAvailability = availability;
  return availability.subscribe(() => {
    const sessionId = controller.sessionState.sessionId;
    if (!controller.sessionState.disposed && sessionId !== null) handleModelCatalogRefresh(controller, sessionId);
  });
}
