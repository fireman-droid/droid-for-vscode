import type { FactoryDroidSessionFactory } from '../../../runtime/session/sessionTypes';
import type { MissionGateway } from './MissionGateway';

/** Restore this orchestrator's selected models before a resumed planning turn. */
export function withMissionPlanningSettings(factory: FactoryDroidSessionFactory, gateway: MissionGateway): FactoryDroidSessionFactory {
  return async (options) => {
    const session = await factory(options);
    try {
      await gateway.restorePlanningSettings(session);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  };
}
