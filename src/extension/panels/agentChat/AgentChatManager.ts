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
    if (controller) this.scan(controller);
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
      if (message.type === 'host.snapshot' || message.type === 'mission.snapshot' ||
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

  private scan(controller: ChatController): void {
    const id = controller.sessionState.sessionId;
    const cwd = controller.sessionState.activeRuntimeCwd;
    if (!id || !cwd) return;
    let family = this.families.get(id);
    if (!family) {
      family = { cwd, controller, bindings: new Map() };
      this.families.set(id, family);
    }
    for (const item of controller.recoveryState.transcript.transcript) {
      if (item.kind !== 'tool' || !item.subagent) continue;
      const identity = `task:${item.toolUseId}`;
      const existing = family.bindings.get(identity);
      const reported = item.subagent.status;
      const status: AgentChatStatus = reported === 'running' ? 'running'
        : reported === 'completed' ? 'completed' : reported === 'failed' ? 'failed'
          : reported === 'cancelled' ? 'cancelled' : 'unknown';
      family.bindings.set(identity, { ...existing,
        entry: { key: existing?.entry.key ?? randomUUID(),
          title: label(item.subagent.description, 256, 'Subagent'),
          role: label(item.subagent.type, 80, 'Worker'), status },
        turnId: item.turnId, toolUseId: item.toolUseId });
    }
    for (const worker of controller.missionState.missionRuntime?.workerConversations() ?? []) {
      const identity = `mission:${worker.sessionId}`;
      const existing = family.bindings.get(identity);
      family.bindings.set(identity, {
        entry: { key: existing?.entry.key ?? randomUUID(), title: label(worker.title, 256, 'Mission worker'),
          role: worker.skillName?.includes('validator') ? 'Validator' : 'Worker',
          status: worker.status === 'finished' ? 'completed' : worker.status },
        sessionId: worker.sessionId,
      });
    }
  }

  private port(parent: () => string | null, current: () => string | null): AgentNavigationPort {
    const read = (): AgentChatNavigationMessage => {
      const parentId = parent();
      const family = parentId ? this.families.get(parentId) : undefined;
      const entries = [...(family?.bindings.values() ?? [])].map(({ entry, sessionId }) => {
        const child = sessionId ? this.children.get(sessionId)?.controller : undefined;
        return child && isTurnActive(child.turnState.turn) ? { ...entry, status: 'running' as const } : entry;
      });
      const selected = entries.find(({ key }) => key === current());
      const agents = entries.slice(-MAX_AGENT_CHAT_SESSIONS);
      if (selected && !agents.includes(selected)) agents[0] = selected;
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
    const sessionId = binding.sessionId;
    if (!sessionId || this.disposed) return;
    const existing = this.children.get(sessionId);
    if (existing) {
      existing.familyId = parentId;
      existing.key = binding.entry.key;
      existing.title = binding.entry.title;
      this.showChild(existing);
      this.publish();
      return;
    }
    const resources = this.options.createChild({ sessionId, cwd: family.cwd });
    resources.controller.subagentState.subagentTranscripts = this.options.root.subagentState.subagentTranscripts;
    this.observe(resources.controller);
    const child: Child = { controller: resources.controller, panel: null, resources,
      familyId: parentId, key: binding.entry.key, title: binding.entry.title };
    this.children.set(sessionId, child);
    this.showChild(child);
    this.publish();
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
