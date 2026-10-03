import type { DisabledModelsStore } from '../models/DisabledModelsStore';
import { bindModelAvailability } from '../models/bindModelAvailability';
import type { ChatController } from './ChatController';
import type { SystemPromptStore } from './capabilities/systemPrompt';
import type { DisposableSubscription } from './internals';
import type { CustomModelsGateway } from './models/customModels';
import type { CustomModelDiscoveryGateway } from './models/modelDiscovery';
import type { ProviderRegistry } from './models/providerRegistry';

/** Window services shared by chats; conversation state and owned resources stay local. */
export interface ChatSharedServices {
  readonly modelAvailability?: DisabledModelsStore;
  readonly daemonCustomModels?: () => Promise<CustomModelsGateway>;
  readonly modelDiscovery?: CustomModelDiscoveryGateway;
  readonly systemPromptStore?: SystemPromptStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly promptProviderApiKey?: () => Thenable<string | undefined>;
}

/** Each controller owns its subscription, never the shared service itself. */
export function bindChatSharedServices(
  controller: ChatController,
  services: ChatSharedServices,
): DisposableSubscription | undefined {
  controller.daemonCustomModels = services.daemonCustomModels;
  controller.modelDiscovery = services.modelDiscovery;
  controller.systemPromptStore = services.systemPromptStore;
  controller.providerRegistry = services.providerRegistry;
  controller.promptProviderApiKey = services.promptProviderApiKey;
  return services.modelAvailability === undefined
    ? undefined
    : bindModelAvailability(controller, services.modelAvailability);
}
