import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  AGENT_CHAT_PROTOCOL_VERSION, MAX_AGENT_CHAT_SESSIONS, parseAgentChatCommand,
  type AgentChatEntry, type AgentChatNavigationMessage, type AgentChatStatus,
} from '../../../shared/protocol/agentChatProtocol';
import type { ChatController } from '../../chat/ChatController';
import type { RuntimeDiagnosticSink } from '../../../runtime/runtimeDiagnostics';
import type { ReviewPanelOpen } from '../../../shared/protocol/reviewPanelProtocol';
import { AgentChatPanel } from './AgentChatPanel';
import { isTurnActive } from '../../chat/internals';
import { stopAgentChat } from './stopAgentChat';

export interface AgentNavigationPort {
  subscribe(listener: (message: AgentChatNavigationMessage) => void): vscode.Disposable;
  replay(): void;
  handleMessage(value: unknown): boolean;
}

interface Binding {
  entry: AgentChatEntry;
  sessionId?: string;
  turnId?: string;
  toolUseId?: string;
  stopPending?: boolean;
  stoppedTurnId?: string | null;
  idleTurnId?: string | null;
}
interface Family {
  cwd: string;
  controller: ChatController;
  bindings: Map<string, Binding>;
}
interface Child {
  controller: ChatController;
  panel: AgentChatPanel | null;
  resources: { openReview(message: ReviewPanelOpen): void; dispose(): void };
  familyId: string;
  key: string;
  title: string;
}

/** Panels attach to original sessions; revealing a child never replaces its parent. */
export class AgentChatManager implements vscode.Disposable {
  private readonly families = new Map<string, Family>();
  private readonly children = new Map<string, Child>();
  private readonly subscriptions = new Map<ChatController, vscode.Disposable>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  readonly navigation: AgentNavigationPort;

  constructor(private readonly options: {
    extensionUri: vscode.Uri;
    root: ChatController;
    diagnostics: RuntimeDiagnosticSink;
    createChild(target: { sessionId: string; cwd: string }): {
      controller: ChatController;
      openReview(message: ReviewPanelOpen): void;
      dispose(): void;
    };
  }) {
    this.navigation = this.port(() => options.root.sessionState.sessionId, () => null);
    this.observe(options.root);
  }

  controllerFor(sessionId: string): ChatController | undefined {
    return this.options.root.sessionState.sessionId === sessionId
      ? this.options.root : this.children.get(sessionId)?.controller;
  }

  openTask(target: { parentSessionId: string; childSessionId: string; toolUseId: string; title: string; cwd: string }): void {
    const controller = this.controllerFor(target.parentSessionId);
    // The transcript service resolved this row and its saved cwd independently
    // of the parent's runtime handshake, including read-only history recovery.
    if (controller) this.scan(controller, target.cwd);
    const family = this.families.get(target.parentSessionId);
    const binding = family?.bindings.get(`task:${target.toolUseId}`);
    if (!family || !binding) {
      void vscode.window.showWarningMessage('The parent task is no longer available. Reopen its chat first.');
      return;
    }
    binding.sessionId = target.childSessionId;
    this.open(target.parentSessionId, family, binding);
  }

  openMission(target: { sessionId: string; title: string }): void {
    this.scan(this.options.root);
    const parentId = this.options.root.sessionState.sessionId;
    const family = parentId ? this.families.get(parentId) : undefined;
    const binding = family?.bindings.get(`mission:${target.sessionId}`);
    if (parentId && family && binding) this.open(parentId, family, binding);
    else void vscode.window.showWarningMessage('This Mission worker is no longer available. Refresh the Mission and try again.');
  }

  private observe(controller: ChatController): void {
    this.subscriptions.set(controller, controller.subscribe((message) => {
      if (message.type === 'host.snapshot') {
        // Session replacement is an identity boundary, not a throttled activity update.
        // Publish an empty/new family together with the authoritative chat snapshot.
        this.scan(controller);
        this.publish();
        return;
      }
      if (message.type === 'mission.snapshot' ||
          message.type === 'subagent.activity' || message.type.startsWith('tool.') ||
          message.type.startsWith('subagent.') || message.type === 'turn.state') this.schedule();
    }));
    this.scan(controller);
  }

  private schedule(): void {
    if (this.disposed || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const controller of this.subscriptions.keys()) this.scan(controller);
      this.publish();
    }, 80);
  }

  private scan(controller: ChatController, historyCwd?: string): void {
    const id = controller.sessionState.sessionId;
    const cwd = historyCwd ?? controller.sessionState.activeRuntimeCwd;
    if (!id || !cwd || historyCwd === undefined && controller.sessionState.connection.status === 'connecting') return;
    let family = this.families.get(id);
    if (!family) {
      family = { cwd, controller, bindings: new Map() };
      this.families.set(id, family);
    }
    const present = new Set<string>();
    for (const item of controller.recoveryState.transcript.transcript) {
      if (item.kind !== 'tool' || !item.subagent) continue;
      const identity = `task:${item.toolUseId}`;
      present.add(identity);
      const existing = family.bindings.get(identity);
      const reported = item.subagent.status;
      const status: AgentChatStatus = reported === 'running' ? 'running'
        : reported === 'completed' ? 'completed' : reported === 'failed' ? 'failed'
          : reported === 'cancelled' ? 'cancelled' : 'unknown';
      const binding = existing ?? { entry: { key: randomUUID(), title: '', role: '', status } };
      Object.assign(binding, {
        entry: { key: binding.entry.key,
          title: label(item.subagent.description, 256, 'Subagent'),
          role: label(item.subagent.type, 80, 'Worker'), status },
        turnId: item.turnId, toolUseId: item.toolUseId });
      family.bindings.set(identity, binding);
    }
    for (const worker of controller.missionState.missionRuntime?.workerConversations() ?? []) {
      const identity = `mission:${worker.sessionId}`;
      present.add(identity);
      const existing = family.bindings.get(identity);
      const binding = existing ?? { entry: { key: randomUUID(), title: '', role: '', status: 'unknown' as const } };
      Object.assign(binding, {
        entry: { key: binding.entry.key, title: label(worker.title, 256, 'Mission worker'),
          role: worker.skillName?.includes('validator') ? 'Validator' : 'Worker',
          status: worker.status === 'finished' ? 'completed' : worker.status },
        sessionId: worker.sessionId,
      });
      family.bindings.set(identity, binding);
    }
    for (const key of family.bindings.keys()) if (!present.has(key)) family.bindings.delete(key);
  }

  private port(parent: () => string | null, current: () => string | null): AgentNavigationPort {
    let lastProjection: string | undefined;
    const read = (): AgentChatNavigationMessage => {
      const parentId = parent();
      const family = parentId ? this.families.get(parentId) : undefined;
      const switching = current() === null && this.options.root.sessionState.connection.status === 'connecting';
      const entries = [...(!switching ? family?.bindings.values() ?? [] : [])].map((binding) => {
        const child = binding.sessionId ? this.children.get(binding.sessionId)?.controller : undefined;
        const turn = child?.turnState.turn;
        const resumed = isTurnActive(turn ?? null) && turn?.turnId !== binding.stoppedTurnId;
        if (resumed) delete binding.stoppedTurnId;
        if (isTurnActive(turn ?? null) && turn?.turnId !== binding.idleTurnId) delete binding.idleTurnId;
        const terminal: AgentChatStatus | undefined = turn?.status === 'interrupted' ? 'cancelled'
          : turn?.status === 'completed' ? 'completed' : turn?.status === 'failed' ? 'failed' : undefined;
        const status: AgentChatStatus = binding.stoppedTurnId !== undefined ? 'cancelled'
          : binding.idleTurnId !== undefined ? terminal ?? (binding.entry.status === 'running' ? 'unknown' : binding.entry.status)
          : child && isTurnActive(turn ?? null) ? 'running'
            : terminal ?? binding.entry.status;
        return { ...binding.entry, status,
          ...(status === 'running' && !binding.stopPending ? { canStop: true as const } : {}),
          ...(binding.stopPending ? { stopPending: true as const } : {}) };
      });
      const selected = entries.find(({ key }) => key === current());
      const agents = entries.slice(-MAX_AGENT_CHAT_SESSIONS);
      if (selected && !agents.includes(selected)) agents[0] = selected;
      const scope = { parentSessionId: parentId ?? '', currentKey: selected?.key ?? '',
        activeSessionId: this.options.root.sessionState.sessionId ?? '',
        conversationId: this.options.root.sessionState.conversationId ?? '', agents: agents.length };
      const projection = JSON.stringify(scope);
      if (projection !== lastProjection) {
        lastProjection = projection;
        this.options.diagnostics.record({ level: 'info', name: 'host.agents.navigation', attributes: scope });
      }
      return { type: 'agent.chat.navigation', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
        parentSessionId: parentId, currentKey: selected?.key ?? null, agents };
    };
    return {
      subscribe: (listener) => {
        const publish = () => listener(read());
        this.listeners.add(publish);
        return { dispose: () => { this.listeners.delete(publish); } };
      },
      replay: () => {
        for (const controller of this.subscriptions.keys()) this.scan(controller);
        this.publish();
      },
      handleMessage: (value) => {
        const command = parseAgentChatCommand(value);
        if (!command) return false;
        if (command.parentSessionId !== parent()) return true;
        const family = this.families.get(command.parentSessionId);
        if (!family) return true;
        if (command.type === 'agent.chat.back') {
          const child = this.children.get(command.parentSessionId);
          if (child) this.showChild(child);
          else {
            if (this.options.root.sessionState.sessionId !== command.parentSessionId) {
              if (!this.options.root.effects.canReplaceSession()) {
                void vscode.window.showWarningMessage('Finish the pending action in the main chat before returning to this task.');
                void vscode.commands.executeCommand('droidvisx.chat.focus');
                return true;
              }
              this.options.root.effects.startReplacement({ kind: 'resume', cwd: family.cwd, sessionId: command.parentSessionId });
            }
            void vscode.commands.executeCommand('droidvisx.chat.focus');
          }
          return true;
        }
        const binding = [...family.bindings.values()].find(({ entry }) => entry.key === command.key);
        if (!binding) return true;
        if (command.type === 'agent.chat.stop') {
          void this.stop(command.parentSessionId, family, binding);
          return true;
        }
        if (binding.sessionId) this.open(command.parentSessionId, family, binding);
        else if (binding.turnId && binding.toolUseId) {
          if (family.controller.sessionState.sessionId === command.parentSessionId)
            family.controller.handleMessage({ type: 'subagent.open', sessionId: command.parentSessionId,
              turnId: binding.turnId, toolUseId: binding.toolUseId });
          else family.controller.subagentState.subagentTranscripts?.open(command.parentSessionId, binding.turnId, binding.toolUseId);
        }
        return true;
      },
    };
  }

  private open(parentId: string, family: Family, binding: Binding): void {
    const child = this.childFor(parentId, family, binding);
    if (child) this.showChild(child);
    this.publish();
  }

  private childFor(parentId: string, family: Family, binding: Binding): Child | undefined {
    const sessionId = binding.sessionId;
    if (!sessionId || this.disposed) return;
    const existing = this.children.get(sessionId);
    if (existing) {
      existing.familyId = parentId;
      existing.key = binding.entry.key;
      existing.title = binding.entry.title;
      return existing;
    }
    const resources = this.options.createChild({ sessionId, cwd: family.cwd });
    resources.controller.subagentState.subagentTranscripts = this.options.root.subagentState.subagentTranscripts;
    this.observe(resources.controller);
    const child: Child = { controller: resources.controller, panel: null, resources,
      familyId: parentId, key: binding.entry.key, title: binding.entry.title };
    this.children.set(sessionId, child);
    return child;
  }

  private async stop(parentId: string, family: Family, binding: Binding): Promise<void> {
    if (binding.stopPending || this.disposed) return;
    binding.stopPending = true;
    this.publish();
    try {
      if (!binding.sessionId && binding.turnId && binding.toolUseId) {
        const service = family.controller.subagentState.subagentTranscripts;
        let target = service?.resolveSession(parentId, binding.turnId, binding.toolUseId);
        if (!target && family.controller.sessionState.sessionId === parentId) {
          await service?.ensureParentMapping(parentId, family.cwd, family.controller.recoveryState.transcript.transcript);
          target = service?.resolveSession(parentId, binding.turnId, binding.toolUseId);
        }
        if (target) binding.sessionId = target.sessionId;
      }
      const child = this.childFor(parentId, family, binding);
      if (!child || !binding.sessionId) throw new Error('The agent session has not been registered yet. Open its conversation and retry.');
      const outcome = await stopAgentChat(child.controller, binding.sessionId);
      if (outcome === 'stopped') binding.stoppedTurnId = child.controller.turnState.turn?.turnId ?? null;
      else {
        binding.idleTurnId = child.controller.turnState.turn?.turnId ?? null;
        if (!this.disposed) void vscode.window.showInformationMessage('This agent is already idle. No stop request was sent.');
      }
    } catch (error) {
      if (!this.disposed) void vscode.window.showWarningMessage(error instanceof Error ? error.message : 'The agent could not be stopped. Open its conversation and retry.');
    } finally {
      binding.stopPending = false;
      if (!this.disposed) { this.scan(family.controller); this.publish(); }
    }
  }

  private showChild(child: Child): void {
    if (child.panel) { child.panel.reveal(); return; }
    child.panel = new AgentChatPanel({
      extensionUri: this.options.extensionUri,
      controller: child.controller,
      diagnostics: this.options.diagnostics,
      title: child.title,
      navigation: this.port(() => child.familyId, () => child.key),
      openReview: child.resources.openReview,
      // Closing a view must not answer/cancel a pending SDK interaction.
      onDispose: () => { child.panel = null; },
    });
  }

  private publish(): void { for (const listener of this.listeners) listener(); }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const child of this.children.values()) {
      child.panel?.dispose();
      child.resources.dispose();
    }
    for (const subscription of this.subscriptions.values()) subscription.dispose();
    this.children.clear();
    this.subscriptions.clear();
    this.listeners.clear();
    this.families.clear();
  }
}

function label(value: string, limit: number, fallback: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim().slice(0, limit) || fallback;
}
