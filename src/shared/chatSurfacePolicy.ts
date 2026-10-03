/** A panel's role is fixed by its Host; agent navigation does not change it. */
export type ChatSurfaceRole = 'main' | 'child';

export interface ChatSurfaceCapabilities {
  readonly navigateSessions: boolean;
  readonly compactSession: boolean;
  readonly editHistory: boolean;
  readonly openMission: boolean;
}

const CAPABILITIES: Readonly<Record<ChatSurfaceRole, ChatSurfaceCapabilities>> = {
  main: { navigateSessions: true, compactSession: true, editHistory: true, openMission: true },
  child: { navigateSessions: false, compactSession: false, editHistory: false, openMission: false },
};

export function getChatSurfaceCapabilities(role: ChatSurfaceRole): ChatSurfaceCapabilities {
  return CAPABILITIES[role];
}

/** Classifies existing commands only; parsing and session ownership remain Host responsibilities. */
export function isChatSurfaceCommandAllowed(role: ChatSurfaceRole, command: {
  readonly type: string;
  readonly field?: unknown;
  readonly value?: unknown;
}): boolean {
  const capabilities = getChatSurfaceCapabilities(role);
  switch (command.type) {
    case 'session.new':
    case 'session.select':
    case 'session.fork':
    case 'worktree.createSession':
      return capabilities.navigateSessions;
    case 'session.compact':
      return capabilities.compactSession;
    case 'turn.editResend':
    case 'rewind.info':
    case 'editStage.begin':
    case 'editStage.cancel':
      return capabilities.editHistory;
  }
  if (command.type.startsWith('mission.') || command.type.startsWith('missionControl.') ||
    command.type === 'session.setting.update' && command.field === 'interactionMode' && command.value === 'mission') {
    return capabilities.openMission;
  }
  return true;
}
