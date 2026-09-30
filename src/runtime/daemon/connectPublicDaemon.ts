import { randomUUID } from 'node:crypto';
import {
  DaemonSessionController,
  LOCAL_MACHINE_ID,
  MachineType,
  MultiMissionStateManager,
  MultiSessionStateManager,
  SDK_TAG,
  SessionPlatform,
  type ConnectToDaemonOptions,
  type CreateDaemonSessionOptions,
  type ResumeDaemonSessionOptions,
} from '@factory/droid-sdk';
import type {
  DaemonApi,
  DaemonHandlers,
  DaemonNotification,
  DaemonSessionHandle,
  DaemonTerminalEvent,
} from './api';
import { bindDaemonInteractions } from './permissionDispatch';
import { createDaemonResources } from './resources';
import { RetainedDaemonSession } from './sessionHandle';
import { DaemonTransportRecovery, type DaemonTransportState } from './transportRecovery';

export interface PublicDaemonOptions extends ConnectToDaemonOptions {
  readonly getAccessToken?: () => Promise<string | null>;
  readonly onConnectionState?: (state: DaemonTransportState) => void;
}

/** SDK 0.9.1 local facade connection policy, owned through its public controller. */
export async function connectPublicDaemon(
  options: PublicDaemonOptions,
): Promise<DaemonApi> {
  const state = new MultiSessionStateManager();
  const missions = new MultiMissionStateManager();
  const controller = new DaemonSessionController({
    sessionStateManager: state,
    missionStateManager: missions,
    config: {
      getMissionStore: (sessionId) => missions.getMissionStore(sessionId),
      getMissionStoreIfKnown: (sessionId) => missions.getMissionStoreIfKnown(sessionId),
      machineId: LOCAL_MACHINE_ID,
      machineType: MachineType.Local,
      url: options.url,
      clientType: 'sdk',
      sdk: SDK_TAG.metadata,
      getAccessToken: options.getAccessToken ?? (async () => options.auth.apiKey),
      onAuthenticationError: options.onAuthenticationError,
      connectionTimeoutMs: 5000,
      requestTimeout: 30000,
      maxPollAttempts: 15,
      maxReconnectAttempts: 3,
      reconnectInterval: 1000,
      maxReconnectDelay: 10000,
      reconnectBackoffFactor: 1.5,
      supportsTerminalRestoreOnLoad: false,
    },
  });
  try {
    await controller.attemptInitialConnection();
    return retainDaemonController(controller, options, missions);
  } catch (error) {
    controller.destroy();
    state.clear();
    throw error;
  }
}

export function retainDaemonController(
  controller: DaemonSessionController,
  options: PublicDaemonOptions,
  missions?: MultiMissionStateManager,
): DaemonApi {
  const handles = new Map<string, RetainedDaemonSession>();
  const reloadOptions = new Map<string, ResumeDaemonSessionOptions>();
  const listeners = new Set<(notification: DaemonNotification) => void>();
  const terminalListeners = new Set<(event: DaemonTerminalEvent) => void>();
  const recovery = new DaemonTransportRecovery(controller, async () => {
    const retained = [...handles.values()];
    const snapshots = await Promise.all(retained.map(async (handle) => {
      if (handles.get(handle.id) !== handle) return undefined;
      try {
        const result = await controller.loadSession({ ...reloadOptions.get(handle.id), sessionId: handle.id });
        if (handles.get(handle.id) === handle) handle.initialize(result.settings, result.cwd);
        return result.session.messages;
      } catch (error) {
        if (handles.get(handle.id) === handle) throw error;
        return undefined;
      }
    }));
    retained.forEach((handle, index) => {
      const messages = snapshots[index];
      if (messages !== undefined && handles.get(handle.id) === handle) handle.restoreTransport(messages);
    });
  }, () => {
    for (const handle of handles.values()) handle.suspendTransport();
  }, (error) => {
    for (const handle of handles.values()) handle.failTransport(error);
  }, options.onConnectionState);
  let disconnected = false;
  const assertConnected = (): void => {
    if (disconnected) throw new Error('Droid connection is disconnected');
  };
  const report = (error: Error): void => {
    options.onError?.(error);
  };
  const unbindInteractions = bindDaemonInteractions(controller, handles, report, {
    waitUntilReady: () => recovery.waitUntilReady(),
    revision: () => recovery.revision(),
    isReady: () => recovery.isReady(),
  });
  const observe = (notification: DaemonNotification): void => {
    handles.get(notification.sessionId)?.observe(notification.notification);
    for (const listener of listeners) listener(notification);
    if (notification.notification.type === 'daemon.terminal_data') {
      const { terminalId, data } = notification.notification;
      for (const listener of terminalListeners)
        listener({ type: 'data', sessionId: notification.sessionId, terminalId, data });
    }
  };
  controller.on('sessionNotification', observe);
  const onTerminalExit = (event: Omit<Extract<DaemonTerminalEvent, { type: 'exit' }>, 'type'>) => {
    for (const listener of terminalListeners) listener({ type: 'exit', ...event });
  };
  const onTerminalDisconnect = () => {
    for (const listener of terminalListeners) listener({ type: 'disconnected' });
  };
  controller.on('terminalExit', onTerminalExit);
  controller.on('disconnected', onTerminalDisconnect);
  controller.on('error', report);
  const register = (id: string, handlers: DaemonHandlers): RetainedDaemonSession => {
    assertConnected();
    if (handles.has(id)) throw new Error(`Session ${id} already has an attached handle`);
    const handle = new RetainedDaemonSession(
      controller,
      id,
      {
        permissionHandler: handlers.permissionHandler ?? options.permissionHandler,
        askUserHandler: handlers.askUserHandler ?? options.askUserHandler,
      },
      () => {
        handles.delete(id);
        reloadOptions.delete(id);
      },
      (signal) => recovery.waitUntilReady(signal),
      missions,
    );
    handles.set(id, handle);
    return handle;
  };
  const create = async (
    input: CreateDaemonSessionOptions,
  ): Promise<DaemonSessionHandle> => {
    await recovery.waitUntilReady();
    const {
      permissionHandler,
      askUserHandler,
      sessionId = randomUUID(),
      tags,
      ...params
    } = input;
    const handle = register(sessionId, { permissionHandler, askUserHandler });
    const { autoRejectPermissionRequests, disableBuiltinSkills, disabledToolIds, mcpServers, structuredOutputFormat } = params;
    reloadOptions.set(sessionId, { autoRejectPermissionRequests, disableBuiltinSkills,
      disabledToolIds, mcpServers, structuredOutputFormat });
    const state = controller.getSessionStateManager();
    const existed = state.getSessionManager(sessionId) !== null;
    try {
      const token = options.getAccessToken === undefined
        ? options.auth.apiKey : await options.getAccessToken();
      if (token === null) throw new Error('Droid sign-in is unavailable.');
      state.markSessionLoading(sessionId, LOCAL_MACHINE_ID);
      const result = await controller.initializeSession({
        ...params,
        sessionId,
        machineId: LOCAL_MACHINE_ID,
        token,
        tags: [...(tags ?? []), SDK_TAG],
        sessionOriginHint: 'api' as Parameters<
          DaemonSessionController['initializeSession']
        >[0]['sessionOriginHint'],
        sessionSource: { platform: SessionPlatform.Api, delegationSessionId: sessionId },
      });
      assertConnected();
      handle.initialize(result.settings, result.worktree?.path ?? input.cwd);
      return handle;
    } catch (error) {
      if (!existed) state.removeSession(sessionId);
      await handle.detach();
      throw error;
    }
  };
  const resume = async (
    id: string,
    input: ResumeDaemonSessionOptions = {},
  ): Promise<DaemonSessionHandle> => {
    await recovery.waitUntilReady();
    const { permissionHandler, askUserHandler, ...params } = input;
    const handle = register(id, { permissionHandler, askUserHandler });
    reloadOptions.set(id, params);
    try {
      const result = await controller.loadSession({
        ...params,
        sessionId: id,
        sessionOriginHint: 'api' as Parameters<
          DaemonSessionController['loadSession']
        >[0]['sessionOriginHint'],
        sessionSource: { platform: SessionPlatform.Api, delegationSessionId: id },
      });
      assertConnected();
      handle.initialize(result.settings, result.cwd);
      return handle;
    } catch (error) {
      await handle.detach();
      throw error;
    }
  };
  const resources = createDaemonResources(controller, assertConnected, () => recovery.waitUntilReady());
  return {
    ...resources,
    waitUntilReady: (signal) => recovery.waitUntilReady(signal),
    sessions: { ...resources.sessions, create, resume },
    notifications: {
      subscribeRecovery: (listener) => recovery.subscribe(listener),
      subscribeTerminal(listener) {
        assertConnected();
        terminalListeners.add(listener);
        return () => { terminalListeners.delete(listener); };
      },
      subscribe(listener) {
        assertConnected();
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async attachChild(sessionId) {
        assertConnected();
        await recovery.waitUntilReady();
        await controller.ensureChildSessionAttached(sessionId);
      },
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      recovery.dispose();
      unbindInteractions();
      controller.off('sessionNotification', observe);
      controller.off('terminalExit', onTerminalExit);
      controller.off('disconnected', onTerminalDisconnect);
      onTerminalDisconnect();
      terminalListeners.clear();
      controller.off('error', report);
      for (const handle of handles.values()) handle.disconnect();
      handles.clear();
      listeners.clear();
      const state = controller.getSessionStateManager();
      controller.destroy();
      state.clear();
    },
  };
}
