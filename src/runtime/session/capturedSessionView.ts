import { type ModelInfo } from '@factory/droid-sdk/node';

import { type FactoryDroidSession } from './sessionTypes';

export function createCapturedSessionView(
  session: FactoryDroidSession,
  availableModels?: readonly ModelInfo[],
): FactoryDroidSession {
  const catalog = availableModels ?? session.availableModels;
  const view: FactoryDroidSession = {
    get id() {
      return session.id;
    },
    get settings() {
      return session.settings;
    },
    ...(catalog === undefined ? {} : { availableModels: [...catalog] }),
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
  if (typeof session.appendHistoryMessage === 'function') {
    view.appendHistoryMessage = (text) => session.appendHistoryMessage!(text);
  }
  if (typeof session.readAvailableModels === 'function') {
    view.readAvailableModels = () => session.readAvailableModels!();
  }
  if (typeof session.readWorkingState === 'function') {
    view.readWorkingState = () => session.readWorkingState!();
  }
  if (typeof session.readTurnOutcome === 'function') {
    view.readTurnOutcome = (backendTurnId) => session.readTurnOutcome!(backendTurnId);
  }
  if (typeof session.readMissionSnapshot === 'function') {
    view.readMissionSnapshot = () => session.readMissionSnapshot!();
  }
  if (typeof session.refreshMissionSnapshot === 'function') {
    view.refreshMissionSnapshot = () => session.refreshMissionSnapshot!();
  }
  if (typeof session.subscribeMissionSnapshot === 'function') {
    view.subscribeMissionSnapshot = (listener) => session.subscribeMissionSnapshot!(listener);
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
    view.getGitDiff = (options) => session.getGitDiff!(options);
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
  if (typeof session.listCommands === 'function') {
    view.listCommands = () => session.listCommands!();
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
    view.authenticateMcpServer = (params) => session.authenticateMcpServer!(params);
  }
  if (typeof session.onNotification === 'function') {
    view.onNotification = (callback, filter) => session.onNotification!(callback, filter);
  }
}
