import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Ban, Check, MoreHorizontal, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { ManagedModel, ModelsAction, ModelsSnapshot } from '../../shared/protocol/modelManagerProtocol';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

export function ModelList({ models, snapshot, disabled, onAction, onEdit }: {
  readonly models: readonly ManagedModel[];
  readonly snapshot: ModelsSnapshot;
  readonly disabled: boolean;
  readonly onAction: (action: ModelsAction) => void;
  readonly onEdit: (model: ManagedModel) => void;
}) {
  const { t } = useI18n();
  return <div className="models-list" aria-label={t("已配置的模型")}>
    {models.map((model) => {
      const current = model.runtimeId !== null && snapshot.activeModelId === model.runtimeId;
      const enabled = model.enabled !== false;
      const connection = snapshot.connections.find((item) => item.id === model.connectionId);
      const loaded = model.runtimeId !== null;
      const unavailable = !loaded ? model.loadMessage || 'Droid 尚未加载此模型，请检查配置后刷新。' : null;
      const act = (kind: 'useModel' | 'verifyModel' | 'deleteModel') =>
        onAction({ kind, rawIndex: model.rawIndex, expectedModel: model.model, connectionId: model.connectionId });
      const setEnabled = () => {
        if (connection) onAction({ kind: 'setModelEnabled', rawIndex: model.rawIndex, expectedModel: model.model,
          provider: connection.protocol, baseUrl: connection.baseUrl, enabled: !enabled });
      };
      return <article key={`${model.rawIndex}:${model.model}`} className="models-model-row" data-current={current || undefined}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h4 className="models-model-name">{model.displayName || model.model}</h4>
            {current ? <span data-ui-notice="" className="models-state"><Check aria-hidden />{t("当前使用")}</span> : null}
            {!enabled ? <span data-ui-notice="" className="models-state">{t("已禁用")}</span> : null}
          </div>
          <span className="models-model-id">{model.model}</span>
          {!enabled ? <p data-ui-notice="" className="models-help mt-2">{current
            ? t("当前回复不会中断；下次发送前请切换模型或恢复此模型。")
            : t("配置已保留，恢复后可选择或验证此模型。")}</p> : unavailable ? <p data-ui-notice="" className="models-help mt-2">{unavailable}</p> : null}
          {model.test ? <p data-ui-notice="" className={`models-help mt-2 ${model.test.status === 'failed' ? 'text-destructive' : ''}`}>
            {model.test.status === 'passed' ? t("本窗口验证通过") : t("验证失败")} · {(model.test.latencyMs / 1000).toFixed(1)} {t("秒")}
            <span className="mt-0.5 block break-words">{model.test.message}</span>
          </p> : null}
        </div>
        <div className="models-row-actions">
          {!current && <Button variant="ghost" size="sm" className="models-use-button" disabled={disabled || !enabled || !loaded || !snapshot.canApply} aria-label={t("使用此模型")}
                aria-describedby={!snapshot.canApply && snapshot.applyMessage ? 'models-apply-status' : undefined}
                title={!enabled ? t("配置已保留，恢复后可选择或验证此模型。") : unavailable ?? undefined} onClick={() => act('useModel')}>{t("使用")}</Button>}
          <Button variant="ghost" size="icon-sm" disabled={disabled || !enabled || !loaded}
            aria-label={t("验证模型…")} title={!enabled ? t("此模型已禁用，可保存修改；恢复后才能验证。") : unavailable ?? t("验证模型…")}
            onClick={() => act('verifyModel')}><Play /></Button>
          <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t("编辑配置")} title={t("编辑配置")} onClick={() => onEdit(model)}><Pencil /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="plain" size="icon-sm" disabled={disabled} aria-label={t("{p0} 的更多操作", { p0: model.displayName || model.model })}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="management-menu min-w-36">
              <DropdownMenuItem disabled={!connection} onSelect={setEnabled} title={enabled && current ? t("当前回复不会中断；下次发送前请切换模型或恢复。") : undefined}>
                {enabled ? <Ban className="size-3.5" /> : <RotateCcw className="size-3.5" />}{enabled ? t("禁用模型") : t("恢复模型")}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={() => act('deleteModel')}><Trash2 className="size-3.5" />{t("删除模型")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>;
    })}
  </div>;
}
