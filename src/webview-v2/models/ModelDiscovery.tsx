import { useId, useState } from 'react';
import { Check, ListFilter, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { MAX_MODEL_CATALOG_ITEMS, MAX_MODEL_DISPLAY_NAME_LENGTH } from '../../shared/protocol/bounds';
import { isSafeText, type DiscoveredCustomModel } from '../../shared/protocol/customModelsProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/selection';
import type { ModelsPageState } from './AddModels';

/** Discovery and selection stay mounted while the user revisits the connection step. */
export function ModelDiscovery({ page, onDone, onManual }: {
  readonly page: ModelsPageState;
  readonly onDone: () => void;
  readonly onManual: () => void;
}) {
  const fieldId = useId();
  const [search, setSearch] = useState('');
  const [hideAdded, setHideAdded] = useState(false);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [aliases, setAliases] = useState<Readonly<Record<string, string>>>({});
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const { connection, discovered, models, chosen, busy } = page;
  const items = discovered ?? [];
  const existing = new Set(models.map((model) => model.model));
  const names = new Set(page.manager.snapshot?.models.map((model) => model.displayName || model.model));
  const displayName = (item: DiscoveredCustomModel) => aliases[item.model] ?? item.displayName ?? '';
  const effectiveName = (item: DiscoveredCustomModel) => displayName(item).trim() || item.model.slice(0, 160);
  const selected = items.filter((item) => chosen.has(item.model) && !existing.has(item.model));
  const selectedNames = new Map<string, number>();
  for (const item of selected) selectedNames.set(effectiveName(item), (selectedNames.get(effectiveName(item)) ?? 0) + 1);
  const errorFor = (item: DiscoveredCustomModel) => {
    if (existing.has(item.model)) return null;
    const alias = displayName(item).trim();
    if (alias && !isSafeText(alias, MAX_MODEL_DISPLAY_NAME_LENGTH)) return '别名包含无效字符或超过长度限制。';
    if (names.has(effectiveName(item))) return '这个名称已被其他模型使用，请设置不同的别名。';
    if ((selectedNames.get(effectiveName(item)) ?? 0) > 1) return '所选模型的别名重复，请调整后再添加。';
    return null;
  };
  const conflicts = selected.filter((item) => errorFor(item) !== null).length;
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) => (!hideAdded || !existing.has(item.model)) &&
    (!onlyChosen || chosen.has(item.model)) && `${item.model} ${displayName(item)}`.toLowerCase().includes(query));
  const selectable = filtered.filter((item) => !existing.has(item.model));
  const unselected = selectable.filter((item) => !chosen.has(item.model));
  const hiddenChosen = selected.filter((item) => !filtered.some((row) => row.model === item.model)).length;
  const chooseFiltered = () => {
    const next = new Set(chosen);
    for (const item of unselected) { if (next.size >= MAX_MODEL_CATALOG_ITEMS) break; next.add(item.model); }
    page.setChosen(next);
  };
  const add = () => {
    if (busy || !connection || !selected.length || conflicts) return;
    const prepared = selected.map((item) => {
      if (aliases[item.model] === undefined) return item;
      const alias = aliases[item.model].trim();
      return alias ? { ...item, displayName: alias } : { model: item.model };
    });
    void page.importModels(connection.id, prepared).then((saved) => {
      if (saved) { page.setSearch(''); onDone(); }
    });
  };
  return <div className="models-discovery">
    <div className="models-search models-discovery-search">
      <Search aria-hidden /><Input type="search" className="h-9 rounded-none border-0 bg-transparent px-0 focus-visible:border-transparent focus-visible:ring-0" disabled={busy} aria-label="筛选发现的模型" placeholder="搜索模型名称或 Model ID…"
        value={search} onChange={(event) => setSearch(event.target.value)} />
      {search ? <Button variant="ghost" size="icon-sm" aria-label="清除模型筛选" disabled={busy} onClick={() => setSearch('')}><X /></Button> : null}
    </div>
    <div className="models-discovery-filters">
      <label className="models-check-label"><Checkbox checked={hideAdded} disabled={busy} onCheckedChange={(value) => setHideAdded(value === true)} />隐藏已添加</label>
      <Button variant="ghost" size="sm" aria-pressed={onlyChosen} disabled={busy} onClick={() => setOnlyChosen(!onlyChosen)}><ListFilter />只看已选</Button>
      <Button variant="ghost" size="icon" className="ml-auto" aria-label="重新获取模型列表" title="重新获取，保留仍可添加的选择" disabled={busy}
        onClick={() => { if (connection) void page.discoverModels(connection.id); }}><RefreshCw /></Button>
    </div>
    <div className="models-selection-toolbar">
      <span className="models-help">显示 {filtered.length} / {items.length} 个</span>
      <Button variant="ghost" size="sm" disabled={busy || !unselected.length || chosen.size >= MAX_MODEL_CATALOG_ITEMS} onClick={chooseFiltered}>选择筛选结果</Button>
      <Button variant="ghost" size="sm" disabled={busy || !chosen.size} onClick={() => page.setChosen(new Set())}>清空选择</Button>
    </div>
    <div className="models-discovery-list" aria-label="服务返回的模型">
      {filtered.map((item, index) => {
        const exists = existing.has(item.model);
        const selected = chosen.has(item.model);
        const error = errorFor(item);
        const aliasOpen = editingAlias === item.model;
        const inputId = `${fieldId}-${index}`;
        return <div key={item.model} className="models-discovery-item" data-selected={!exists && selected} data-added={exists}>
          <div className="models-discovery-row">
            <label className="models-discovery-choice">
              <Checkbox aria-label={item.model} checked={exists || selected} disabled={busy || exists || (!selected && chosen.size >= MAX_MODEL_CATALOG_ITEMS)}
                onCheckedChange={(value) => {
                  const next = new Set(chosen);
                  if (value === true) next.add(item.model); else next.delete(item.model);
                  page.setChosen(next);
                }} />
              <span className="min-w-0 flex-1"><code>{item.model}</code>
                {displayName(item).trim() && !aliasOpen ? <span className="models-model-alias">{displayName(item).trim()}</span> : null}
              </span>
            </label>
            {exists ? <span className="models-added"><Check aria-hidden />已添加</span> :
              <Button variant="ghost" size="icon" aria-label={`修改 ${item.model} 的导入别名`} aria-expanded={aliasOpen}
                title="设置显示别名" disabled={busy} onClick={() => setEditingAlias(aliasOpen ? null : item.model)}><Pencil /></Button>}
          </div>
          {aliasOpen ? <div className="models-import-alias">
            <label htmlFor={inputId}>显示别名 <span className="models-optional">可选</span></label>
            <Input id={inputId} autoFocus disabled={busy} value={displayName(item)} maxLength={MAX_MODEL_DISPLAY_NAME_LENGTH}
              placeholder="留空时使用 Model ID" aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => setAliases((current) => ({ ...current, [item.model]: event.target.value }))} />
          </div> : null}
          {error ? <p className="models-import-error" id={`${inputId}-error`}>{error}
            {!aliasOpen ? <Button variant="link" size="sm" disabled={busy} onClick={() => setEditingAlias(item.model)}>设置别名</Button> : null}
          </p> : null}
        </div>;
      })}
      {filtered.length === 0 ? <div className="models-discovery-no-results"><Search aria-hidden /><h3>{items.length ? '没有符合筛选条件的模型' : '这个接口没有返回模型列表'}</h3>
        <p className="models-help">{items.length ? '已选项会保留，可以清除筛选继续查找。' : '服务可能不支持模型发现，仍可使用已知的 Model ID 添加。'}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={items.length ? () => { setSearch(''); setHideAdded(false); setOnlyChosen(false); } : onManual}>{items.length ? '清除筛选条件' : '手动填写 ID'}</Button>
      </div> : null}
    </div>
    <div className="models-form-actions models-selection-actions">
      <div className="models-selection-summary" role="status" aria-live="polite"><strong>已选 {selected.length} 个</strong>
        <span className={conflicts ? 'text-destructive' : 'models-help'}>{conflicts ? `${conflicts} 个别名需要调整` : hiddenChosen ? `${hiddenChosen} 个在当前筛选之外` : `一次最多添加 ${MAX_MODEL_CATALOG_ITEMS} 个`}</span>
      </div>
      <Button variant="ghost" disabled={busy} onClick={onDone}>取消</Button>
      <Button disabled={busy || !selected.length || !!conflicts} onClick={add}>{busy ? '正在添加…' : `添加所选模型（${selected.length}）`}</Button>
    </div>
  </div>;
}
