import {
  SessionNotificationSchema,
  type AvailableModelConfig,
} from '@factory/droid-sdk/node';

import type { FactoryDroidSession } from './FactoryDroidRuntime';
import {
  captureLastCallTokenUsage,
  type CapturedLastCallTokenUsage,
} from './modelCatalogCaptureTransport';

export function createCapturedSessionView(
  session: FactoryDroidSession,
  availableModels?: readonly AvailableModelConfig[],
  initialLastCallTokenUsage: CapturedLastCallTokenUsage = {
    status: 'missing',
  },
): FactoryDroidSession {
  const catalog = availableModels ?? session.availableModels;
  let lastCallTokenUsage = initialLastCallTokenUsage;
  const unsubscribeContext =
    typeof session.readContextWindowSource === 'function' ||
    typeof session.onNotification !== 'function'
      ? undefined
      : session.onNotification((raw) => {
          if (!isTokenUsageNotificationForSession(raw, session.id)) {
            return;
          }
          const parsed = SessionNotificationSchema.safeParse(raw);
          if (!parsed.success) {
            lastCallTokenUsage = { status: 'invalid' };
            return;
          }
          const notification = parsed.data.params.notification;
          if (
            notification.type !== 'session_token_usage_changed' ||
            notification.sessionId !== session.id
          ) {
            return;
          }
          lastCallTokenUsage = captureLastCallTokenUsage(
            notification.lastCallTokenUsage,
          );
        });
  let contextReleased = false;
  const releaseContextWindowSource = (): void => {
    if (contextReleased) {
      return;
    }
    contextReleased = true;
    unsubscribeContext?.();
  };
  const view: FactoryDroidSession = {
    get id() {
      return session.id;
    },
    get settings() {
      return session.settings;
    },
    ...(catalog === undefined
      ? {}
      : { availableModels: [...catalog] }),
    get cwd() {
      return session.cwd;
    },
    stream(prompt, options) {
      return session.stream(prompt, options);
    },
    interrupt() {
      return session.interrupt();
    },
    updateSettings(params) {
      return session.updateSettings(params);
    },
    getContextStats() {
      return session.getContextStats();
    },
    async readContextWindowSource() {
      if (typeof session.readContextWindowSource === 'function') {
        return session.readContextWindowSource();
      }
      const stats = await session.getContextStats();
      return {
        limit: stats.limit,
        lastCallTokenUsage,
      };
    },
    releaseContextWindowSource,
    async close() {
      releaseContextWindowSource();
      await session.close();
    },
  };
  copyOptionalSessionMethods(view, session);
  return view;
}

function copyOptionalSessionMethods(
  view: FactoryDroidSession,
  session: FactoryDroidSession,
): void {
  if (typeof session.readWorkingState === 'function') {
    view.readWorkingState = () => session.readWorkingState!();
  }
  if (typeof session.rewind === 'function') {
    view.rewind = (params) => session.rewind!(params);
  }
  if (typeof session.getRewindInfo === 'function') {
    view.getRewindInfo = (params) => session.getRewindInfo!(params);
  }
  if (typeof session.compact === 'function') {
    view.compact = (params) => session.compact!(params);
  }
  if (typeof session.fork === 'function') {
    view.fork = (params) => session.fork!(params);
  }
  if (typeof session.rename === 'function') {
    view.rename = (params) => session.rename!(params);
  }
  if (typeof session.listSkills === 'function') {
    view.listSkills = () => session.listSkills!();
  }
  if (typeof session.setSkillDisabled === 'function') {
    view.setSkillDisabled = (params) => session.setSkillDisabled!(params);
  }
  if (typeof session.listMcpServers === 'function') {
    view.listMcpServers = () => session.listMcpServers!();
  }
  if (typeof session.listMcpTools === 'function') {
    view.listMcpTools = () => session.listMcpTools!();
  }
  if (typeof session.toggleMcpServer === 'function') {
    view.toggleMcpServer = (params) => session.toggleMcpServer!(params);
  }
  if (typeof session.addMcpServer === 'function') {
    view.addMcpServer = (params) => session.addMcpServer!(params);
  }
  if (typeof session.removeMcpServer === 'function') {
    view.removeMcpServer = (params) => session.removeMcpServer!(params);
  }
  if (typeof session.authenticateMcpServer === 'function') {
    view.authenticateMcpServer = (params) =>
      session.authenticateMcpServer!(params);
  }
  if (typeof session.onNotification === 'function') {
    view.onNotification = (callback, filter) =>
      session.onNotification!(callback, filter);
  }
}

function isTokenUsageNotificationForSession(
  raw: Record<string, unknown>,
  sessionId: string,
): boolean {
  const params = raw['params'];
  if (typeof params !== 'object' || params === null) {
    return false;
  }
  const notification = (params as Record<string, unknown>)['notification'];
  if (typeof notification !== 'object' || notification === null) {
    return false;
  }
  const record = notification as Record<string, unknown>;
  return (
    record['type'] === 'session_token_usage_changed' &&
    record['sessionId'] === sessionId
  );
}
