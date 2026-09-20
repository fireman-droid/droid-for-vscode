import { Check, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import type { ManagedModel, ModelsAction, ModelsSnapshot } from '../../shared/protocol/modelManagerProtocol';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

export function ModelList({ models, snapshot, disabled, onAction, onEdit, onRename }: {
  readonly models: readonly ManagedModel[];
  readonly snapshot: ModelsSnapshot;
  readonly disabled: boolean;
  readonly onAction: (action: ModelsAction) => void;
  readonly onEdit: (model: ManagedModel) => void;
  readonly onRename: (model: ManagedModel) => void;
}) {
  return <div className="models-list" aria-label="已配置的模型">
    {models.map((model) => {
      const current = model.runtimeId !== null && snapshot.activeModelId === model.runtimeId;
      const loaded = model.runtimeId !== null;
      const unavailable = !loaded ? model.loadMessage || 'Droid 尚未加载此模型，请检查配置后刷新。'
        : !snapshot.canApply && !current ? snapshot.applyMessage : null;
      const act = (kind: 'useModel' | 'verifyModel' | 'deleteModel') =>
        onAction({ kind, rawIndex: model.rawIndex, expectedModel: model.model });
      return <article key={`${model.rawIndex}:${model.model}`} className="models-model-row" data-current={current || undefined}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="break-words text-[14px] font-medium">{model.displayName || model.model}</h3>
            <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`修改 ${model.displayName || model.model} 的别名`}
              title="修改模型别名" onClick={() => onRename(model)}><Pencil className="size-3" /></Button>
            {current ? <span className="models-state"><Check className="size-3" />当前使用</span> : null}
          </div>
          <code className="mt-1 block break-all text-[11.5px] text-muted-foreground">{model.model}</code>
          {unavailable ? <p className="models-help mt-2">{unavailable}</p> : null}
          {model.test ? <p className={`models-help mt-2 ${model.test.status === 'failed' ? 'text-destructive' : ''}`}>
            {model.test.status === 'passed' ? '本窗口验证通过' : '验证失败'} · {(model.test.latencyMs / 1000).toFixed(1)} 秒
            <span className="mt-0.5 block break-words">{model.test.message}</span>
          </p> : null}
        </div>
        <div className="models-row-actions">
          <Button variant={current ? 'ghost' : 'outline'} size="sm" disabled={disabled || current || !loaded || !snapshot.canApply}
            title={unavailable ?? undefined} onClick={() => act('useModel')}>{current ? '正在使用' : '使用此模型'}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="data-[state=open]:bg-[var(--control-surface-hover)] data-[state=open]:text-foreground" disabled={disabled} aria-label={`${model.displayName || model.model} 的更多操作`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem disabled={!loaded} onSelect={() => act('verifyModel')}><Play className="size-3.5" />验证模型…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(model)}><Pencil className="size-3.5" />编辑配置</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={() => act('deleteModel')}><Trash2 className="size-3.5" />删除模型</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>;
    })}
  </div>;
}
