import * as vscode from 'vscode';
import { BUSY_MESSAGE_MODE_SETTING } from '../chat/queue/busyMessageSettings';
import {
  MANAGEMENT_VERSION, parseManagementRequest, type ManagementAction, type ManagementHostMessage,
  type ManagementPage, type ManagementRequest, type ManagementResult,
} from '../../shared/protocol/managementPageProtocol';
import type { ManagementSessionCatalog } from '../../runtime/catalog/ManagementSessionCatalog';
import type { ManagedSession } from '../../shared/protocol/managementPageProtocol';
import type { MissionCatalogResult } from '../chat/mission/MissionGateway';
import { projectFactoryLimits } from '../chat/capabilities/factoryLimits';
import type { ManagementSettingsService } from './managementSettings';
import type { ManagementDefaultsService } from './ManagementDefaultsService';
import type { FactoryAccountService } from '../account/FactoryAccountService';
import { LIMITS_REQUEST_FAILED_MESSAGE } from '../../runtime/account/factoryAccount';
import type { FactoryAccountState } from '../../shared/protocol/factoryAccountProtocol';

export interface ManagementServices {
  readonly settings: ManagementSettingsService;
  readonly defaults: ManagementDefaultsService;
  readonly sessions: ManagementSessionCatalog;
  readonly sessionsAvailable: boolean;
  readonly viewSession: (row: ManagedSession) => void;
  readonly exportSession: (row: ManagedSession) => Promise<void>;
  readonly resumeSession: (row: ManagedSession) => Promise<void>;
  readonly refreshSessions: () => void;
  readonly missions: () => Promise<MissionCatalogResult>;
  readonly openMission: (id: string) => void;
  readonly newMission: () => void;
  /** Factory sign-in identity and limits for the sidebar footer. */
  readonly account: FactoryAccountService;
}

/** Management owns no chat runtime: opening this panel never replaces the chat. */
export class ManagementBinding implements vscode.Disposable {
  private disposed = false;
  private busy = false;
  private ready = false;
  private readonly subscriptions: vscode.Disposable[];
  constructor(private readonly webview: Pick<vscode.Webview, 'postMessage' | 'onDidReceiveMessage'>, private readonly services: ManagementServices,
    private page: ManagementPage) {
    this.subscriptions = [
      webview.onDidReceiveMessage((value: unknown) => {
        const request = parseManagementRequest(value);
        if (request) void this.run(request);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('droidvisx')) void this.refreshSettings();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => { void this.refreshSettings(); }),
    ];
  }
  navigate(page: ManagementPage): void {
    this.page = page;
    if (this.ready) this.post({ type: 'management.navigate', version: MANAGEMENT_VERSION, page });
  }
  private async refreshSettings(): Promise<void> {
    if (!this.ready || this.busy || this.disposed) return;
    try { this.post({ type: 'management.settings', version: MANAGEMENT_VERSION, settings: await this.services.settings.read() }); }
    catch { void vscode.window.showErrorMessage('Droid 管理页无法刷新设置，请在管理页重试。'); }
  }
  private async run(request: ManagementRequest): Promise<void> {
    const base = { type: 'management.result', version: MANAGEMENT_VERSION, requestId: request.requestId } as const;
    if (request.action.kind === 'account.read') {
      const account = await this.readAccount(request.action.force);
      this.post({ ...base, ok: true, account });
      return;
    }
    if (this.busy) { this.post({ ...base, ok: false, message: '请等待当前操作完成。' }); return; }
    this.busy = true;
    try {
      const data = await this.execute(request.action);
      this.post({ ...base, ok: true, ...data });
      if (request.action.kind === 'ready') { this.ready = true; this.navigate(this.page); }
    } catch (error) {
      this.post({ ...base, ok: false, message: error instanceof Error ? error.message : '操作未完成，请重试。' });
    } finally { this.busy = false; }
  }
  private async execute(action: ManagementAction): Promise<Partial<ManagementResult>> {
    const s = this.services;
    switch (action.kind) {
      case 'ready': case 'settings.read': return { settings: await s.settings.read() };
      case 'account.read': return { account: await this.readAccount(action.force) };
      case 'defaults.read': return { defaults: await s.defaults.read() };
      case 'defaults.save': return { defaults: await s.defaults.save(action.patch), message: '默认设置已保存，当前聊天保持不变。' };
      case 'theme.set':
        await vscode.workspace.getConfiguration('droidvisx').update('theme', action.theme, vscode.ConfigurationTarget.Global);
        return { settings: await s.settings.read() };
      case 'chat.busyMessageMode.set':
        await vscode.workspace.getConfiguration('droidvisx').update(BUSY_MESSAGE_MODE_SETTING, action.mode, vscode.ConfigurationTarget.Global);
        return { settings: await s.settings.read() };
      case 'language.set':
        await vscode.workspace.getConfiguration('droidvisx').update('language', action.language, vscode.ConfigurationTarget.Global);
        return { settings: await s.settings.read() };
      case 'reviewQuestion.model.set':
        await s.settings.saveQuestionModel(action.modelId, action.reasoningEffort);
        return { settings: await s.settings.read() };
      case 'completion.save':
        await s.settings.save(action.preferences, action.setApiKey, action.setNextEditApiKey);
        return { settings: await s.settings.read(), message: '已保存' };
      case 'chat.focus': await vscode.commands.executeCommand('droidvisx.focusView'); return {};
      case 'missions.new': s.newMission(); return {};
      case 'missions.list': {
        const result = await s.missions();
        if (result.status !== 'ready') throw new Error(result.message);
        return { missions: result.rows };
      }
      case 'missions.open': s.openMission(action.id); return {};
      case 'sessions.list':
        if (!s.sessionsAvailable) throw new Error('会话管理需要 daemon 运行模式。');
        return s.sessions.list(action.scope, action.cursor);
      default: {
        const row = s.sessions.target(action.id);
        switch (action.kind) {
          case 'session.view': s.viewSession(row); break;
          case 'session.export': await s.exportSession(row); break;
          case 'session.resume': await s.resumeSession(row); break;
          case 'session.folder': await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(row.cwd), { forceNewWindow: true }); break;
          case 'session.favorite': await s.sessions.favorite(row.id, action.value); s.refreshSessions(); break;
          case 'session.archive': await s.sessions.archive(row.id, action.value); s.refreshSessions(); break;
          case 'session.rename': await s.sessions.rename(row.id, action.title); s.refreshSessions(); break;
        }
        return {};
      }
    }
  }
  /**
   * Account identity is the sidebar's footer; the same read also
   * supplies the limits `/limits` shows, so both surfaces stay in
   * step without a second billing request.
   */
  private async readAccount(force: boolean): Promise<FactoryAccountState> {
    let result;
    try {
      result = await this.services.account.read({ force });
    } catch {
      return { status: 'unavailable', message: LIMITS_REQUEST_FAILED_MESSAGE };
    }
    if (result.status === 'unavailable') return result;
    if (result.status === 'identity-only') {
      return {
        status: 'ready',
        identity: result.identity,
        limits: null,
        limitsError: result.limitsError,
        fetchedAt: new Date().toISOString(),
      };
    }
    return {
      status: 'ready',
      identity: result.identity,
      limits: projectFactoryLimits(result),
      limitsError: null,
      fetchedAt: new Date().toISOString(),
    };
  }
  private post(message: ManagementHostMessage): void {
    if (!this.disposed) void this.webview.postMessage(message);
  }
  dispose(): void { this.disposed = true; for (const subscription of this.subscriptions) subscription.dispose(); }
}
