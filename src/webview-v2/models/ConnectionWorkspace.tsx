import { useState } from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { ListToolbar } from '@droidvisx/chat-ui/ui/list-toolbar';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { AddModels, type ModelsPageState } from './AddModels';
import { AliasForm, ConnectionForm, ModelForm } from './ModelForms';
import { ModelList } from './ModelList';
import { PROTOCOLS } from './protocols';

/** One workspace; each existing operation keeps its own save/cancel boundary. */
export function ConnectionWorkspace({ page, creating, onCreated, onClose }: {
  readonly page: ModelsPageState;
  readonly creating: boolean;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [alias, setAlias] = useState(false);
  const { manager, connection, busy } = page;
  const { snapshot, run } = manager;
  const editing = page.editing || alias || adding;
  const finishAdding = () => { setAdding(false); page.setDiscovery(null); page.setChosen(new Set()); };
  if (creating) return <ConnectionForm connection={null} busy={busy} onCancel={onClose}
    onSave={draft => { void page.saveConnection(draft).then(saved => { if (saved) onCreated(); }); }} />;
  if (!connection || !snapshot) return null;
  const models = snapshot.models.filter(model => model.connectionId === connection.id);
  return <div className="models-connection-workspace">
    <section className="models-workspace-section" aria-label={t("渠道设置")}>
      <header className="models-workspace-section-heading"><h3>{t("渠道设置")}</h3>
        <div className="management-actions">
          <Button variant="ghost" size="sm" disabled={busy || editing} onClick={() => {
            manager.setNotice(null); page.setConnectionForm({ connection });
          }}><Pencil />{t("编辑配置")}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="plain" size="icon-sm" disabled={busy || editing}
            aria-label={t("{p0} 的更多操作", { p0: connection.name })}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent className="management-menu" align="end">
              <DropdownMenuItem onSelect={() => { manager.setNotice(null); setAlias(true); }}><Pencil />{t("服务商别名")}</DropdownMenuItem>
              <DropdownMenuItem disabled={models.length > 0} onSelect={() => {
                void run({ kind: 'deleteConnection', connectionId: connection.id }).then(result => { if (result.ok) onClose(); });
              }}><Trash2 />{t("移除空渠道")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {page.connectionForm ? <ConnectionForm connection={page.connectionForm.connection} busy={busy}
        onCancel={() => page.setConnectionForm(null)} onSave={draft => { void page.saveConnection(draft); }} />
        : alias ? <AliasForm name={connection.providerName || new URL(connection.baseUrl).host} label={t("服务商别名")} maxLength={80}
          busy={busy} onCancel={() => setAlias(false)} onSave={name => {
            void run({ kind: 'renameProvider', providerHost: new URL(connection.baseUrl).host, name }).then(result => { if (result.ok) setAlias(false); });
          }} />
        : <dl className="models-connection-fields">
          <div><dt data-ui-notice="">{t("接口别名")}</dt><dd>{connection.name}</dd></div>
          <div><dt data-ui-notice="">{t("兼容接口")}</dt><dd>{PROTOCOLS[connection.protocol].name}</dd></div>
          <div><dt data-ui-notice="">Base URL</dt><dd className="models-connection-url">{connection.baseUrl}</dd></div>
          <div><dt data-ui-notice="">API Key</dt><dd data-ui-notice="">{connection.hasKey ? t("密钥已保存") : t("未配置密钥")}</dd></div>
        </dl>}
    </section>
    <section className="models-workspace-section management-models" aria-label={t("已配置的模型")}>
      <header className="models-workspace-section-heading"><h3>{t("模型")} <span>{models.length}</span></h3>
        <Button variant="outline" size="sm" disabled={busy || editing} aria-label={t("向{p0}添加模型", { p0: connection.name })}
          onClick={() => { manager.setNotice(null); setAdding(true); }}><Plus />{t("添加模型")}</Button>
      </header>
      {!snapshot.canApply && snapshot.applyMessage ? <p data-ui-notice="" id="models-dialog-apply-status" className="models-help">
        {t("当前聊天暂时不能切换模型；仍可管理渠道和模型配置。")}
      </p> : null}
      {page.modelForm ? <ModelForm model={page.modelForm.model} connection={connection} busy={busy} existingModels={snapshot.models}
        onCancel={() => page.setModelForm(null)} onSave={(draft, verify) => { void page.saveModel(draft, verify); }} />
        : adding ? <AddModels page={page} step="models" onStepChange={() => {}} onNewConnection={() => {}} onDone={finishAdding} channelBound />
        : <>
          <ListToolbar label={t("搜索已配置模型")} placeholder={t("搜索模型")} value={page.search} onChange={page.setSearch} />
          <ModelList models={page.visible} snapshot={snapshot} disabled={busy || editing}
            onAction={action => { void run(action); }} onEdit={model => { manager.setNotice(null); page.setModelForm({ model }); }} />
          {page.visible.length === 0 ? <p data-ui-notice="" className="models-help">{models.length ? t("没有匹配的模型") : t("尚未添加模型")}</p> : null}
        </>}
    </section>
  </div>;
}
