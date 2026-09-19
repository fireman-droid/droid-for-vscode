import { randomUUID } from 'node:crypto';
import {
  DaemonSessionController,
  LOCAL_MACHINE_ID,
  MachineType,
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

/** SDK 0.7.0 local facade connection policy, now owned through its public controller. */
export async function connectPublicDaemon(
  options: ConnectToDaemonOptions,
): Promise<DaemonApi> {
  const state = new MultiSessionStateManager();
  const controller = new DaemonSessionController({
    sessionStateManager: state,
    config: {
      machineId: LOCAL_MACHINE_ID,
      machineType: MachineType.Local,
      url: options.url,
      clientType: 'sdk',
      getAccessToken: async () => options.auth.apiKey,
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
    return retainDaemonController(controller, options);
  } catch (error) {
    controller.destroy();
    state.clear();
    throw error;
  }
}

export function retainDaemonController(
  controller: DaemonSessionController,
  options: ConnectToDaemonOptions,
): DaemonApi {
  const handles = new Map<string, RetainedDaemonSession>();
  const listeners = new Set<(notification: DaemonNotification) => void>();
  const terminalListeners = new Set<(event: DaemonTerminalEvent) => void>();
  let disconnected = false;
  const assertConnected = (): void => {
    if (disconnected) throw new Error('Droid connection is disconnected');
  };
  const report = (error: Error): void => {
    options.onError?.(error);
  };
  const unbindInteractions = bindDaemonInteractions(controller, handles, report);
  const observe = (notification: DaemonNotification): void => {
    handles.get(notification.sessionId)?.observe(notification.notification);
    for (const listener of listeners) listener(notification);
  };
  controller.on('sessionNotification', observe);
  const onTerminalData = (event: Omit<Extract<DaemonTerminalEvent, { type: 'data' }>, 'type'>) => {
    for (const listener of terminalListeners) listener({ type: 'data', ...event });
  };
  const onTerminalExit = (event: Omit<Extract<DaemonTerminalEvent, { type: 'exit' }>, 'type'>) => {
    for (const listener of terminalListeners) listener({ type: 'exit', ...event });
  };
  const onTerminalDisconnect = () => {
    for (const listener of terminalListeners) listener({ type: 'disconnected' });
  };
  controller.on('terminalData', onTerminalData);
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
      },
    );
    handles.set(id, handle);
    return handle;
  };
  const create = async (
    input: CreateDaemonSessionOptions,
  ): Promise<DaemonSessionHandle> => {
    const {
      permissionHandler,
      askUserHandler,
      sessionId = randomUUID(),
      tags,
      ...params
    } = input;
    const handle = register(sessionId, { permissionHandler, askUserHandler });
    const state = controller.getSessionStateManager();
    const existed = state.getSessionManager(sessionId) !== null;
    try {
      state.markSessionLoading(sessionId, LOCAL_MACHINE_ID);
      const result = await controller.initializeSession({
        ...params,
        sessionId,
        machineId: LOCAL_MACHINE_ID,
        token: options.auth.apiKey,
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
    const { permissionHandler, askUserHandler, ...params } = input;
    const handle = register(id, { permissionHandler, askUserHandler });
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
  const resources = createDaemonResources(controller, assertConnected);
  return {
    ...resources,
    sessions: { ...resources.sessions, create, resume },
    notifications: {
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
        await controller.ensureChildSessionAttached(sessionId);
      },
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      unbindInteractions();
      controller.off('sessionNotification', observe);
      controller.off('terminalData', onTerminalData);
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
