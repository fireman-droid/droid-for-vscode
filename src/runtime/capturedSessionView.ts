import {
  type AvailableModelConfig,
} from '@factory/droid-sdk/node';

import type { FactoryDroidSession } from './FactoryDroidRuntime';

export function createCapturedSessionView(
  session: FactoryDroidSession,
  availableModels?: readonly AvailableModelConfig[],
): FactoryDroidSession {
  const catalog = availableModels ?? session.availableModels;
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
    async close() {
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
  if (typeof session.readContextBreakdown === 'function') {
    view.readContextBreakdown = () => session.readContextBreakdown!();
  }
  if (typeof session.rewind === 'function') {
    view.rewind = (params) => session.rewind!(params);
  }
  if (typeof session.getRewindInfo === 'function') {
    view.getRewindInfo = (params) => session.getRewindInfo!(params);
  }
  if (typeof session.getGitDiff === 'function') {
    view.getGitDiff = () => session.getGitDiff!();
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
