import { useI18n, translate, type UiLocale } from '@droidvisx/chat-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Download, Eye, Folder, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Search, Star } from 'lucide-react';
import type { ManagedSession, ManagementAction } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Tooltip } from '../ui/overlays';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ManagementChoice } from './ManagementFields';
import { SessionPagination } from './SessionPagination';
import type { ManagementState } from './useManagement';
import { DefaultsSettings } from './DefaultsSettings';
import { SessionListLoading } from './ManagementListLoading';

function updatedLabel(value: string, locale: UiLocale): string {
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const date = new Date(value);
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return minutes === 0 ? translate(locale, 'just now') : relativeTime.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return relativeTime.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(minutes) < 10080) return relativeTime.format(Math.round(minutes / 1440), 'day');
  return date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' });
}

export function SessionManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const { t, locale } = useI18n();
  const [section, setSection] = useState('history');
  const historyActive = active && section === 'history';
  const [scope, setScope] = useState<'folder' | 'all'>('folder');
  const [kind, setKind] = useState('all');
  const [filter, setFilter] = useState('normal');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly ManagedSession[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ManagedSession | null>(null);
  const [title, setTitle] = useState('');
  const generation = useRef(0);
  const matching = (items: readonly ManagedSession[]) => items.filter(row => (kind === 'all' || row.kind === kind)
    && (filter === 'archived' ? row.archived : !row.archived && (filter !== 'favorites' || row.favorite))
    && `${row.title} ${row.cwd}`.toLowerCase().includes(query.toLowerCase()));
  const visible = matching(rows);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  const pageRows = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const load = async (next?: number, targetPage = currentPage) => {
    const revision = ++generation.current;
    let collected = next === undefined ? [] : rows;
    let nextCursor: number | null | undefined = next;
    setLoading(true); setError(null);
    try {
      do {
        const result = await state.run({ kind: 'sessions.list', scope, ...(nextCursor === undefined ? {} : { cursor: nextCursor }) });
        if (generation.current !== revision) return;
        if (!result.ok || !result.sessions) { setError(result.message || '会话目录读取失败'); return; }
        collected = [...new Map([...collected, ...result.sessions].map(row => [row.id, row])).values()];
        nextCursor = result.nextCursor ?? null;
        // One matching row beyond the page establishes whether Next is available.
      } while (nextCursor !== null && matching(collected).length <= (targetPage + 1) * pageSize);
      setRows(collected); setCursor(nextCursor); setLoaded(true);
      setPage(Math.min(targetPage, Math.max(0, Math.ceil(matching(collected).length / pageSize) - 1)));
    } finally { if (generation.current === revision) setLoading(false); }
  };
  const changeFilter = (change: () => void) => {
    ++generation.current; setLoading(false); setError(null); setPage(0); change();
  };
  useEffect(() => { if (!historyActive) { ++generation.current; setLoading(false); } }, [historyActive]);
  useEffect(() => () => { ++generation.current; }, []);
  useEffect(() => {
    if (!historyActive || !state.settings?.sessionManagementAvailable || state.busy || loading || error) return;
    if (!loaded) void load();
    else if (cursor !== null && visible.length <= (currentPage + 1) * pageSize) void load(cursor, currentPage);
  }, [historyActive, state.settings, state.busy, loaded, loading, error, cursor, currentPage, pageSize, visible.length, scope, kind, filter, query]);
  const updateRow = (id: string, update: Partial<ManagedSession>) => {
    const updated = rows.map(row => row.id === id ? { ...row, ...update } : row);
    setRows(updated);
    setPage(previous => Math.min(previous, Math.max(0, Math.ceil(matching(updated).length / pageSize) - 1)));
  };
  const act = (action: ManagementAction, update?: Partial<ManagedSession>) => {
    void state.run(action).then(result => {
      if (result.ok && update && 'id' in action) updateRow(action.id, update);
    });
  };
  const pending = loading || (!loaded && !error && (state.settings === null || state.settings.sessionManagementAvailable));
  const disabled = state.busy || pending;
  return <section aria-label={t("会话管理")}>
    <header className="management-heading"><h1>{t("会话")}</h1>{section === 'history' && <Button variant="plain" size="icon-sm" aria-label={t("刷新会话")} disabled={disabled} onClick={() => void load()}><RefreshCw className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>}</header>
    <Tabs value={section} onValueChange={value => { setSection(value); state.setNotice(null); }} className="management-page-tabs">
      <TabsList animatedIndicator aria-label={t("会话页面")}><TabsTrigger value="history">{t("历史记录")}</TabsTrigger><TabsTrigger value="defaults">{t("默认设置")}</TabsTrigger></TabsList>
      <TabsContent value="defaults" forceMount hidden={section !== 'defaults'}><DefaultsSettings state={state} scope="sessions" active={active && section === 'defaults'} /></TabsContent>
      <TabsContent value="history" forceMount hidden={section !== 'history'}>
    <div className="management-toolbar"><Tabs value={scope} onValueChange={value => changeFilter(() => { setScope(value as 'folder' | 'all'); setRows([]); setCursor(null); setLoaded(false); })}>
      <TabsList animatedIndicator className="management-session-scope" aria-label={t("会话范围")} aria-busy={loading}><Tooltip content={state.settings?.cwd || t("未打开文件夹")}><TabsTrigger value="folder" disabled={disabled}>{t("当前文件夹")}</TabsTrigger></Tooltip><TabsTrigger value="all" disabled={disabled}>{t("全部文件夹")}</TabsTrigger></TabsList>
    </Tabs><div className="management-actions"><ManagementChoice label={t("会话类型")} value={kind} onChange={value => changeFilter(() => setKind(value))} options={[[ 'all', t('聊天与 Exec') ], ['chat', t('聊天')], ['exec', 'Exec']]} />
      <ManagementChoice label={t("收藏与归档")} value={filter} onChange={value => changeFilter(() => setFilter(value))} options={[[ 'normal', t('未归档') ], ['favorites', t('收藏')], ['archived', t('已归档')]]} /></div></div>
    <div className="management-search management-session-search"><Search /><Input aria-label={t("筛选会话")} placeholder={t("搜索标题或文件夹")} value={query} onChange={e => changeFilter(() => setQuery(e.target.value))} /></div>
    {state.settings && !state.settings.sessionManagementAvailable ? <p className="management-empty">{t("会话管理需要 daemon 运行模式。")}</p> : <>
      {error && <p role="alert" className="management-caption text-destructive">{t(error)}</p>}
      {pending && <p role="status" className="sr-only">{t("正在读取会话")}</p>}
      <div className="management-session-table" aria-busy={pending}>
        <div className="management-session-head"><span>{t("标题")}</span><span>{t("消息数")}</span><span>{t("更新时间")}</span><span /></div>
        {!loaded && pending && <SessionListLoading />}
        {pageRows.map(row => <div className="management-session-row" key={row.id}>
          <Button variant="plain" size="none" className="management-session-title"
            title={row.kind === 'exec' ? t("查看执行记录") : row.archived ? t("恢复归档后可继续对话") : t("在主聊天中打开")}
            onClick={() => act({ kind: row.kind === 'chat' ? 'session.resume' : 'session.view', id: row.id })} disabled={disabled}>
            <span><span className="management-session-name">{row.title}</span>{row.favorite && <Star aria-label={t("已收藏")} />}</span>
            <small title={row.cwd}>{row.cwd.split(/[\\/]/).filter(Boolean).at(-1) || row.cwd}{row.kind === 'exec' ? ' · Exec' : row.active ? t("· 当前聊天") : ''}</small>
          </Button>
          <span className="management-count">{row.messageCount}</span><time dateTime={row.modifiedTime} title={new Date(row.modifiedTime).toLocaleString(locale)}>{updatedLabel(row.modifiedTime, locale)}</time>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="plain" size="icon-sm" aria-label={t("{p0}的操作", { p0: row.title })} disabled={disabled}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="management-menu">
              <DropdownMenuItem onSelect={() => act({ kind: 'session.view', id: row.id })}><Eye />{t("查看记录")}</DropdownMenuItem>
              {row.kind === 'chat' && <DropdownMenuItem disabled={row.archived} onSelect={() => act({ kind: 'session.resume', id: row.id })}><MessageSquare />{t("继续对话")}</DropdownMenuItem>}
              {!row.currentFolder && <DropdownMenuItem onSelect={() => act({ kind: 'session.folder', id: row.id })}><Folder />{t("打开所属文件夹")}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => act({ kind: 'session.export', id: row.id })}><Download />{t("导出 Markdown")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setRenaming(row); setTitle(row.title); }}><Pencil />{t("重命名")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act({ kind: 'session.favorite', id: row.id, value: !row.favorite }, { favorite: !row.favorite })}><Star />{row.favorite ? t("取消收藏") : t("收藏")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={row.active} onSelect={() => act({ kind: 'session.archive', id: row.id, value: !row.archived }, { archived: !row.archived })}>
                {row.archived ? <ArchiveRestore /> : <Archive />}{row.archived ? t("恢复会话") : t("归档")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>)}
      </div>
      {loaded && !loading && visible.length === 0 && !error && <p className="management-empty">{t("没有匹配的会话")}</p>}
      {loaded && (visible.length > 0 || cursor !== null) && <SessionPagination page={currentPage} pageSize={pageSize} count={visible.length}
        complete={loaded && cursor === null} loading={loading} disabled={disabled} onPageSize={size => changeFilter(() => setPageSize(size))}
        onPage={target => {
          if (cursor !== null && visible.length <= (target + 1) * pageSize) void load(cursor, target);
          else setPage(target);
        }} />}
    </>}
      </TabsContent>
    </Tabs>
    <Dialog open={renaming !== null} onOpenChange={open => { if (!open && !state.busy) setRenaming(null); }}><DialogContent className="management-dialog" closeDisabled={state.busy}>
      <DialogTitle>{t("重命名会话")}</DialogTitle><DialogDescription className="management-caption">{renaming?.cwd}</DialogDescription>
      <form onSubmit={e => { e.preventDefault(); if (!renaming || state.busy || !title.trim()) return;
        void state.run({ kind: 'session.rename', id: renaming.id, title: title.trim() }).then(result => {
          if (result.ok) { updateRow(renaming.id, { title: title.trim() }); setRenaming(null); }
        });
      }}><Input aria-label={t("会话标题")} autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} disabled={state.busy} />
        {state.notice && !state.notice.ok && <p role="alert" className="management-caption text-destructive">{state.notice.message}</p>}
        <footer className="management-form-actions"><Button variant="plain" size="sm" disabled={state.busy} onClick={() => setRenaming(null)}>{t("取消")}</Button><Button variant="outline" size="sm" type="submit" disabled={state.busy || !title.trim()}>{t("保存")}</Button></footer>
      </form>
    </DialogContent></Dialog>
  </section>;
}
