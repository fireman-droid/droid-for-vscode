import type { ChatController } from './ChatController';
import { bindSessionIdentity, commitSessionBinding, showSessionHistory } from './sessions/sessionBinding';
import { attachTurnRecovery, beginTurn, clearTurn, restoreTurn } from './turns/turnLifecycle';
import { reconnectRecoveredIde, resumeRecoveredIdeReconnect } from './ideIntegration';
import {
  loadHistoryTimed,
  prepareActivationTranscript,
} from './recovery/activationTranscript';
import {
  canStageAttachments,
  clearPendingAttachments,
  echoUserImageAttachments,
  emitAttachments,
  emitEditAttachments,
  retainSentAttachments,
  stageAttachmentPayloads,
  stagedCount,
  takePendingAttachments,
} from './attachments/attachments';
import {
  emitModelCatalog,
  pushActivationSkills,
  recordRecentCommand,
  refreshContext,
  updateTokenUsage,
} from './capabilities/capabilityPanels';
import {
  readConversationTurnChanges,
  readLatestConversationChanges,
} from './changes/conversationChanges';
import {
  adoptDurableSuccessor,
  createDurableForkConversation,
} from './recovery/conversationLineage';
import { buildHostSnapshot } from './hostSnapshot';
import { capturePreToolBaseline, recordLiveToolChanges, startLiveChanges } from './changes/liveChanges';
import { pushActivationMcp } from './capabilities/mcp';
import { recoverMissionProjection } from './mission/recovery';
import { handleMissionRuntimeEvent } from './mission/runtimeEvents';
import { handleProviderModels } from './models/providerModels';
import { publishTurnChanges } from './changes/publishTurnChanges';
import {
  discardQueuedPrompts,
  projectQueueState,
  restoreQueuedPrompts,
  settleQueueAfterTurn,
} from './queue/queue';
import {
  checkpointRecoveryTranscript,
  flushRecoveryCheckpoint,
  flushRecoveryCheckpointInBackground,
  flushRecoveryCheckpointOrReport,
  markRecoveryCheckpointUnavailable,
  persistActivationRecoveryCheckpoint,
  reconcileDaemonTurn,
  recoveryTurnId,
  scheduleRecoveryCheckpoint,
} from './recovery/recovery';
import { canReplaceSession, replaceRuntime, startReplacement, startup } from './sessions/runtimeLifecycle';
import { closeRuntime, resetSessionMetadata } from './sessions/sessionCleanup';
import { emitWorkspaceUnavailable, ensureActiveRuntimeWorkspaceCurrent, waitForWorkspaceTransition } from './sessions/workspaceLifecycle';
import { isCurrentRuntime, isTargetWorkspaceCurrent } from './sessions/sessionGuards';
import {
  activeSessionSummary,
  beginCatalogLoad,
  bindCatalogViewToWorkspace,
  clearCatalog,
  discardCatalogRequest,
  hasCatalogSession,
  isCurrentCatalogRequest,
  loadCatalog,
  touchActiveSession,
  withActiveSession,
} from './sessions/sessionCatalog';
import {
  loadSessionMetadata,
  markSessionSwitchReady,
} from './capabilities/sessionMetadata';
import {
  ensureBackgroundRunningPoll,
  seedBackgroundRunning,
  setSessionRunning,
  stampRunningFlags,
} from './sessions/sessionRunning';
import { emitSettings, refreshSettingsAfterRuntimeEvent } from './capabilities/settings';
import { resolveSettledChangeFiles } from './changes/settleTurnChanges';
import {
  armReplayedSubagentWatch,
  scheduleLiveSubagentSync,
  settleTurnSubagents,
} from './subagents/subagentWatch';
import { mirrorExecuteEvent } from './turns/terminalMirrorFlow';
import {
  discardPendingThinking,
  flushPendingThinking,
  queueThinkingProjection,
} from './turns/thinkingBatch';
import { failTurn, handleStop, refreshContextAfterTurn, setTurnStatus, handleTurnComplete } from './turns/turnSettlement';
import { handleSend } from './turns/turnFlow';
import { isCurrentTurn } from './turns/turnIdentity';
import {
  armTurnWatchdog,
  clearTurnWatchdog,
  markStopRequested,
} from './turns/turnWatchdog';
type BoundEffect<F> = F extends (owner: never, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;
export interface ChatEffects {
  bindSessionIdentity: BoundEffect<typeof bindSessionIdentity>;
  commitSessionBinding: BoundEffect<typeof commitSessionBinding>;
  showSessionHistory: BoundEffect<typeof showSessionHistory>;
  beginTurn: BoundEffect<typeof beginTurn>;
  clearTurn: BoundEffect<typeof clearTurn>;
  restoreTurn: BoundEffect<typeof restoreTurn>;
  attachTurnRecovery: BoundEffect<typeof attachTurnRecovery>;
  startup: BoundEffect<typeof startup>;
  resetSessionMetadata: BoundEffect<typeof resetSessionMetadata>;
  checkpointRecoveryTranscript: BoundEffect<typeof checkpointRecoveryTranscript>;
  bindCatalogViewToWorkspace: BoundEffect<typeof bindCatalogViewToWorkspace>;
  canStageAttachments: BoundEffect<typeof canStageAttachments>;
  stagedCount: BoundEffect<typeof stagedCount>;
  stageAttachmentPayloads: BoundEffect<typeof stageAttachmentPayloads>;
  emitEditAttachments: BoundEffect<typeof emitEditAttachments>;
  emitAttachments: BoundEffect<typeof emitAttachments>;
  ensureActiveRuntimeWorkspaceCurrent: BoundEffect<
    typeof ensureActiveRuntimeWorkspaceCurrent
  >;
  waitForWorkspaceTransition: BoundEffect<typeof waitForWorkspaceTransition>;
  buildHostSnapshot: BoundEffect<typeof buildHostSnapshot>;
  handleProviderModels: BoundEffect<typeof handleProviderModels>;
  startReplacement: BoundEffect<typeof startReplacement>;
  handleSend: BoundEffect<typeof handleSend>;
  createDurableForkConversation: BoundEffect<typeof createDurableForkConversation>;
  clearPendingAttachments: BoundEffect<typeof clearPendingAttachments>;
  withActiveSession: BoundEffect<typeof withActiveSession>;
  stampRunningFlags: BoundEffect<typeof stampRunningFlags>;
  projectQueueState: BoundEffect<typeof projectQueueState>;
  closeRuntime: BoundEffect<typeof closeRuntime>;
  resolveSettledChangeFiles: BoundEffect<typeof resolveSettledChangeFiles>;
  handleStop: BoundEffect<typeof handleStop>;
  setSessionRunning: BoundEffect<typeof setSessionRunning>;
  isCurrentTurn: BoundEffect<typeof isCurrentTurn>;
  failTurn: BoundEffect<typeof failTurn>;
  loadHistoryTimed: BoundEffect<typeof loadHistoryTimed>;
  refreshContextAfterTurn: BoundEffect<typeof refreshContextAfterTurn>;
  setTurnStatus: BoundEffect<typeof setTurnStatus>;
  handleTurnComplete: BoundEffect<typeof handleTurnComplete>;
  readConversationTurnChanges: BoundEffect<typeof readConversationTurnChanges>;
  readLatestConversationChanges: () => ReturnType<typeof readLatestConversationChanges>;
  clearCatalog: BoundEffect<typeof clearCatalog>;
  beginCatalogLoad: BoundEffect<typeof beginCatalogLoad>;
  loadCatalog: BoundEffect<typeof loadCatalog>;
  isCurrentCatalogRequest: BoundEffect<typeof isCurrentCatalogRequest>;
  discardCatalogRequest: BoundEffect<typeof discardCatalogRequest>;
  seedBackgroundRunning: BoundEffect<typeof seedBackgroundRunning>;
  hasCatalogSession: BoundEffect<typeof hasCatalogSession>;
  flushRecoveryCheckpoint: BoundEffect<typeof flushRecoveryCheckpoint>;
  markRecoveryCheckpointUnavailable: BoundEffect<
    typeof markRecoveryCheckpointUnavailable
  >;
  ensureBackgroundRunningPoll: BoundEffect<typeof ensureBackgroundRunningPoll>;
  prepareActivationTranscript: BoundEffect<typeof prepareActivationTranscript>;
  markSessionSwitchReady: BoundEffect<typeof markSessionSwitchReady>;
  recoveryTurnId: BoundEffect<typeof recoveryTurnId>;
  persistActivationRecoveryCheckpoint: BoundEffect<
    typeof persistActivationRecoveryCheckpoint
  >;
  recoverMissionProjection: BoundEffect<typeof recoverMissionProjection>;
  loadSessionMetadata: BoundEffect<typeof loadSessionMetadata>;
  restoreQueuedPrompts: BoundEffect<typeof restoreQueuedPrompts>;
  reconcileDaemonTurn: BoundEffect<typeof reconcileDaemonTurn>;
  reconnectRecoveredIde: BoundEffect<typeof reconnectRecoveredIde>;
  resumeRecoveredIdeReconnect: BoundEffect<typeof resumeRecoveredIdeReconnect>;
  armReplayedSubagentWatch: BoundEffect<typeof armReplayedSubagentWatch>;
  discardQueuedPrompts: BoundEffect<typeof discardQueuedPrompts>;
  canReplaceSession: BoundEffect<typeof canReplaceSession>;
  emitWorkspaceUnavailable: BoundEffect<typeof emitWorkspaceUnavailable>;
  isTargetWorkspaceCurrent: BoundEffect<typeof isTargetWorkspaceCurrent>;
  flushRecoveryCheckpointOrReport: BoundEffect<typeof flushRecoveryCheckpointOrReport>;
  emitSettings: BoundEffect<typeof emitSettings>;
  emitModelCatalog: BoundEffect<typeof emitModelCatalog>;
  refreshContext: BoundEffect<typeof refreshContext>;
  pushActivationSkills: BoundEffect<typeof pushActivationSkills>;
  pushActivationMcp: BoundEffect<typeof pushActivationMcp>;
  discardPendingThinking: BoundEffect<typeof discardPendingThinking>;
  armTurnWatchdog: BoundEffect<typeof armTurnWatchdog>;
  takePendingAttachments: BoundEffect<typeof takePendingAttachments>;
  scheduleRecoveryCheckpoint: BoundEffect<typeof scheduleRecoveryCheckpoint>;
  touchActiveSession: BoundEffect<typeof touchActiveSession>;
  recordRecentCommand: BoundEffect<typeof recordRecentCommand>;
  echoUserImageAttachments: BoundEffect<typeof echoUserImageAttachments>;
  flushPendingThinking: BoundEffect<typeof flushPendingThinking>;
  capturePreToolBaseline: BoundEffect<typeof capturePreToolBaseline>;
  handleMissionRuntimeEvent: BoundEffect<typeof handleMissionRuntimeEvent>;
  queueThinkingProjection: BoundEffect<typeof queueThinkingProjection>;
  mirrorExecuteEvent: BoundEffect<typeof mirrorExecuteEvent>;
  recordLiveToolChanges: BoundEffect<typeof recordLiveToolChanges>;
  startLiveChanges: BoundEffect<typeof startLiveChanges>;
  scheduleLiveSubagentSync: BoundEffect<typeof scheduleLiveSubagentSync>;
  retainSentAttachments: BoundEffect<typeof retainSentAttachments>;
  updateTokenUsage: BoundEffect<typeof updateTokenUsage>;
  refreshSettingsAfterRuntimeEvent: BoundEffect<typeof refreshSettingsAfterRuntimeEvent>;
  publishTurnChanges: BoundEffect<typeof publishTurnChanges>;
  settleTurnSubagents: BoundEffect<typeof settleTurnSubagents>;
  adoptDurableSuccessor: BoundEffect<typeof adoptDurableSuccessor>;
  markStopRequested: BoundEffect<typeof markStopRequested>;
  replaceRuntime: BoundEffect<typeof replaceRuntime>;
  activeSessionSummary: BoundEffect<typeof activeSessionSummary>;
  clearTurnWatchdog: BoundEffect<typeof clearTurnWatchdog>;
  settleQueueAfterTurn: BoundEffect<typeof settleQueueAfterTurn>;
  isCurrentRuntime: BoundEffect<typeof isCurrentRuntime>;
  flushRecoveryCheckpointInBackground: BoundEffect<
    typeof flushRecoveryCheckpointInBackground
  >;
}
export function createChatEffects(controller: ChatController): ChatEffects {
  return {
    bindSessionIdentity: (...args) => bindSessionIdentity(controller, ...args),
    commitSessionBinding: (...args) => commitSessionBinding(controller, ...args),
    showSessionHistory: (...args) => showSessionHistory(controller, ...args),
    beginTurn: (...args) => beginTurn(controller, ...args),
    clearTurn: () => clearTurn(controller),
    restoreTurn: (...args) => restoreTurn(controller, ...args),
    attachTurnRecovery: (...args) => attachTurnRecovery(controller, ...args),
    startup: () => startup(controller),
    resetSessionMetadata: (...args) => resetSessionMetadata(controller, ...args),
    checkpointRecoveryTranscript: () => checkpointRecoveryTranscript(controller),
    bindCatalogViewToWorkspace: (...args) => bindCatalogViewToWorkspace(controller, ...args),
    canStageAttachments: (...args) => canStageAttachments(controller, ...args),
    stagedCount: (...args) => stagedCount(controller, ...args),
    stageAttachmentPayloads: (...args) => stageAttachmentPayloads(controller, ...args),
    emitEditAttachments: (...args) => emitEditAttachments(controller, ...args),
    emitAttachments: (...args) => emitAttachments(controller, ...args),
    ensureActiveRuntimeWorkspaceCurrent: (...args) =>
      ensureActiveRuntimeWorkspaceCurrent(controller, ...args),
    waitForWorkspaceTransition: (...args) =>
      waitForWorkspaceTransition(controller, ...args),
    buildHostSnapshot: (...args) => buildHostSnapshot(controller, ...args),
    handleProviderModels: (...args) => handleProviderModels(controller, ...args),
    startReplacement: (...args) => startReplacement(controller, ...args),
    handleSend: (...args) => handleSend(controller, ...args),
    createDurableForkConversation: (...args) =>
      createDurableForkConversation(controller, ...args),
    clearPendingAttachments: (...args) => clearPendingAttachments(controller, ...args),
    withActiveSession: (...args) => withActiveSession(controller, ...args),
    stampRunningFlags: (...args) => stampRunningFlags(controller, ...args),
    projectQueueState: (...args) => projectQueueState(controller, ...args),
    closeRuntime: (...args) => closeRuntime(controller, ...args),
    resolveSettledChangeFiles: (...args) =>
      resolveSettledChangeFiles(controller, ...args),
    handleStop: (...args) => handleStop(controller, ...args),
    setSessionRunning: (...args) => setSessionRunning(controller, ...args),
    isCurrentTurn: (...args) => isCurrentTurn(controller, ...args),
    failTurn: (...args) => failTurn(controller, ...args),
    loadHistoryTimed: (...args) => loadHistoryTimed(controller, ...args),
    refreshContextAfterTurn: (...args) => refreshContextAfterTurn(controller, ...args),
    setTurnStatus: (...args) => setTurnStatus(controller, ...args),
    handleTurnComplete: (...args) => handleTurnComplete(controller, ...args),
    readConversationTurnChanges: (...args) =>
      readConversationTurnChanges(controller, ...args),
    readLatestConversationChanges: () => readLatestConversationChanges(controller),
    clearCatalog: (...args) => clearCatalog(controller, ...args),
    beginCatalogLoad: (...args) => beginCatalogLoad(controller, ...args),
    loadCatalog: (...args) => loadCatalog(controller, ...args),
    isCurrentCatalogRequest: (...args) => isCurrentCatalogRequest(controller, ...args),
    discardCatalogRequest: (...args) => discardCatalogRequest(controller, ...args),
    seedBackgroundRunning: (...args) => seedBackgroundRunning(controller, ...args),
    hasCatalogSession: (...args) => hasCatalogSession(controller, ...args),
    flushRecoveryCheckpoint: (...args) => flushRecoveryCheckpoint(controller, ...args),
    markRecoveryCheckpointUnavailable: (...args) =>
      markRecoveryCheckpointUnavailable(controller, ...args),
    ensureBackgroundRunningPoll: (...args) =>
      ensureBackgroundRunningPoll(controller, ...args),
    prepareActivationTranscript: (...args) =>
      prepareActivationTranscript(controller, ...args),
    markSessionSwitchReady: (...args) => markSessionSwitchReady(controller, ...args),
    recoveryTurnId: (...args) => recoveryTurnId(controller, ...args),
    persistActivationRecoveryCheckpoint: (...args) =>
      persistActivationRecoveryCheckpoint(controller, ...args),
    recoverMissionProjection: (...args) => recoverMissionProjection(controller, ...args),
    loadSessionMetadata: (...args) => loadSessionMetadata(controller, ...args),
    restoreQueuedPrompts: (...args) => restoreQueuedPrompts(controller, ...args),
    reconcileDaemonTurn: (...args) => reconcileDaemonTurn(controller, ...args),
    reconnectRecoveredIde: (...args) => reconnectRecoveredIde(controller, ...args),
    resumeRecoveredIdeReconnect: () => resumeRecoveredIdeReconnect(controller),
    armReplayedSubagentWatch: (...args) => armReplayedSubagentWatch(controller, ...args),
    discardQueuedPrompts: (...args) => discardQueuedPrompts(controller, ...args),
    canReplaceSession: (...args) => canReplaceSession(controller, ...args),
    emitWorkspaceUnavailable: (...args) => emitWorkspaceUnavailable(controller, ...args),
    isTargetWorkspaceCurrent: (...args) => isTargetWorkspaceCurrent(controller, ...args),
    flushRecoveryCheckpointOrReport: (...args) =>
      flushRecoveryCheckpointOrReport(controller, ...args),
    emitSettings: (...args) => emitSettings(controller, ...args),
    emitModelCatalog: (...args) => emitModelCatalog(controller, ...args),
    refreshContext: (...args) => refreshContext(controller, ...args),
    pushActivationSkills: (...args) => pushActivationSkills(controller, ...args),
    pushActivationMcp: (...args) => pushActivationMcp(controller, ...args),
    discardPendingThinking: (...args) => discardPendingThinking(controller, ...args),
    armTurnWatchdog: (...args) => armTurnWatchdog(controller, ...args),
    takePendingAttachments: (...args) => takePendingAttachments(controller, ...args),
    scheduleRecoveryCheckpoint: (...args) =>
      scheduleRecoveryCheckpoint(controller, ...args),
    touchActiveSession: (...args) => touchActiveSession(controller, ...args),
    recordRecentCommand: (...args) => recordRecentCommand(controller, ...args),
    echoUserImageAttachments: (...args) => echoUserImageAttachments(controller, ...args),
    flushPendingThinking: (...args) => flushPendingThinking(controller, ...args),
    capturePreToolBaseline: (...args) => capturePreToolBaseline(controller, ...args),
    handleMissionRuntimeEvent: (...args) =>
      handleMissionRuntimeEvent(controller, ...args),
    queueThinkingProjection: (...args) => queueThinkingProjection(controller, ...args),
    mirrorExecuteEvent: (...args) => mirrorExecuteEvent(controller, ...args),
    recordLiveToolChanges: (...args) => recordLiveToolChanges(controller, ...args),
    startLiveChanges: (...args) => startLiveChanges(controller, ...args),
    scheduleLiveSubagentSync: (...args) => scheduleLiveSubagentSync(controller, ...args),
    retainSentAttachments: (...args) => retainSentAttachments(controller, ...args),
    updateTokenUsage: (...args) => updateTokenUsage(controller, ...args),
    refreshSettingsAfterRuntimeEvent: (...args) =>
      refreshSettingsAfterRuntimeEvent(controller, ...args),
    publishTurnChanges: (...args) => publishTurnChanges(controller, ...args),
    settleTurnSubagents: (...args) => settleTurnSubagents(controller, ...args),
    adoptDurableSuccessor: (...args) => adoptDurableSuccessor(controller, ...args),
    markStopRequested: (...args) => markStopRequested(controller, ...args),
    replaceRuntime: (...args) => replaceRuntime(controller, ...args),
    activeSessionSummary: (...args) => activeSessionSummary(controller, ...args),
    clearTurnWatchdog: (...args) => clearTurnWatchdog(controller, ...args),
    settleQueueAfterTurn: (...args) => settleQueueAfterTurn(controller, ...args),
    isCurrentRuntime: (...args) => isCurrentRuntime(controller, ...args),
    flushRecoveryCheckpointInBackground: (...args) =>
      flushRecoveryCheckpointInBackground(controller, ...args),
  };
}
