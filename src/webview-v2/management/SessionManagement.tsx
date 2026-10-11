import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Download, Folder, LoaderCircle, MoreHorizontal, RefreshCw, Search, Star } from 'lucide-react';
import type { ManagedSession, ManagementAction } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger } from '../ui/selection';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Tooltip } from '../ui/overlays';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ManagementChoice } from './ManagementFields';
import type { ManagementState } from './useManagement';

const PAGE_SIZE = 10;

export function SessionManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const [scope, setScope] = useState<'folder' | 'all'>('folder');
  const [kind, setKind] = useState('all');
  const [filter, setFilter] = useState('normal');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly ManagedSession[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [page, setPage] = useState(0);
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
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
  const pageRows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasNext = visible.length > (currentPage + 1) * PAGE_SIZE || cursor !== null;
  const load = async (next?: number, targetPage = 0) => {
    const revision = ++generation.current;
    let collected = next === undefined ? [] : rows;
    let nextCursor: number | null | undefined = next;
    setLoading(true); setError(null);
    if (next === undefined) { setRows([]); setCursor(null); setPage(0); setLoaded(false); }
    try {
      do {
        const result = await state.run({ kind: 'sessions.list', scope, ...(nextCursor === undefined ? {} : { cursor: nextCursor }) });
        if (generation.current !== revision) return;
        if (!result.ok || !result.sessions) { setError(result.message || '会话目录读取失败'); return; }
        collected = [...new Map([...collected, ...result.sessions].map(row => [row.id, row])).values()];
        nextCursor = result.nextCursor ?? null;
        setRows(collected); setCursor(nextCursor); setLoaded(true);
        // One matching row beyond the page establishes whether Next is available.
      } while (nextCursor !== null && matching(collected).length <= (targetPage + 1) * PAGE_SIZE);
      setPage(Math.min(targetPage, Math.max(0, Math.ceil(matching(collected).length / PAGE_SIZE) - 1)));
    } finally { if (generation.current === revision) setLoading(false); }
  };
  const changeFilter = (change: () => void) => {
    ++generation.current; setLoading(false); setError(null); setPage(0); change();
  };
  useEffect(() => { if (!active) { ++generation.current; setLoading(false); } }, [active]);
  useEffect(() => () => { ++generation.current; }, []);
  useEffect(() => {
    if (!active || !state.settings?.sessionManagementAvailable || state.busy || loading || error) return;
    if (!loaded) void load();
    else if (cursor !== null && visible.length <= (currentPage + 1) * PAGE_SIZE) void load(cursor, currentPage);
  }, [active, state.settings, state.busy, loaded, loading, error, cursor, currentPage, visible.length, scope, kind, filter, query]);
  const updateRow = (id: string, update: Partial<ManagedSession>) => {
    const updated = rows.map(row => row.id === id ? { ...row, ...update } : row);
    setRows(updated);
    setPage(previous => Math.min(previous, Math.max(0, Math.ceil(matching(updated).length / PAGE_SIZE) - 1)));
  };
  const act = (action: ManagementAction, update?: Partial<ManagedSession>) => {
    void state.run(action).then(result => {
      if (result.ok && update && 'id' in action) updateRow(action.id, update);
    });
  };
  const disabled = state.busy || loading;
  return <section aria-label="会话管理">
    <header className="management-heading"><h1>会话</h1><Button variant="plain" size="icon-sm" aria-label="刷新会话" disabled={disabled} onClick={() => void load()}><RefreshCw /></Button></header>
    <div className="management-toolbar"><Tabs value={scope} onValueChange={value => changeFilter(() => { setScope(value as 'folder' | 'all'); setRows([]); setCursor(null); setLoaded(false); })}>
      <TabsList aria-label="会话范围"><Tooltip content={state.settings?.cwd || '未打开文件夹'}><TabsTrigger value="folder" disabled={disabled}>当前文件夹</TabsTrigger></Tooltip><TabsTrigger value="all" disabled={disabled}>全部文件夹</TabsTrigger></TabsList>
    </Tabs><div className="management-actions"><ManagementChoice label="会话类型" value={kind} onChange={value => changeFilter(() => setKind(value))} options={[[ 'all', '聊天与 Exec' ], ['chat', '聊天'], ['exec', 'Exec']]} />
      <ManagementChoice label="收藏与归档" value={filter} onChange={value => changeFilter(() => setFilter(value))} options={[[ 'normal', '未归档' ], ['favorites', '收藏'], ['archived', '已归档']]} /></div></div>
    <div className="management-search management-session-search"><Search /><Input aria-label="筛选会话" placeholder="搜索标题或文件夹" value={query} onChange={e => changeFilter(() => setQuery(e.target.value))} /></div>
    {!state.settings?.sessionManagementAvailable ? <p className="management-empty">会话管理需要 daemon 运行模式。</p> : <>
      {error && <p role="alert" className="management-caption text-destructive">{error}</p>}
      <div className="management-session-table" aria-busy={loading}>
        <div className="management-session-head"><span>标题</span><span>修改</span><span>消息数</span><span /></div>
        {pageRows.map(row => <div className="management-session-row" key={row.id}>
          <Button variant="plain" size="none" className="management-session-title" onClick={() => act({ kind: 'session.view', id: row.id })} disabled={disabled}>
            <span><span className="management-session-name">{row.title}</span>{row.favorite && <Star aria-label="已收藏" />}</span>
            {(scope === 'all' || row.kind === 'exec' || row.active) && <small>{scope === 'all' ? row.cwd : row.kind === 'exec' ? 'Exec' : '当前聊天'}</small>}
          </Button>
          <time title={row.modifiedTime}>{new Date(row.modifiedTime).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}</time><span className="management-count">{row.messageCount}</span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="plain" size="icon-sm" aria-label={`${row.title}的操作`} disabled={disabled}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="management-menu">
              <DropdownMenuItem onSelect={() => act({ kind: 'session.view', id: row.id })}>查看记录</DropdownMenuItem>
              {row.currentFolder && row.kind === 'chat' ? <DropdownMenuItem disabled={row.archived} onSelect={() => act({ kind: 'session.resume', id: row.id })}>继续对话</DropdownMenuItem>
                : !row.currentFolder && <DropdownMenuItem onSelect={() => act({ kind: 'session.folder', id: row.id })}><Folder />打开所属文件夹</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => act({ kind: 'session.export', id: row.id })}><Download />导出 Markdown</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setRenaming(row); setTitle(row.title); }}>重命名</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act({ kind: 'session.favorite', id: row.id, value: !row.favorite }, { favorite: !row.favorite })}><Star />{row.favorite ? '取消收藏' : '收藏'}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={row.active} onSelect={() => act({ kind: 'session.archive', id: row.id, value: !row.archived }, { archived: !row.archived })}>
                {row.archived ? <ArchiveRestore /> : <Archive />}{row.archived ? '恢复会话' : '归档'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>)}
      </div>
      {!loading && visible.length === 0 && !error && <p className="management-empty">没有匹配的会话</p>}
      {(loading || visible.length > 0 || cursor !== null) && <nav className="management-pagination" aria-label="会话分页">
        <Button variant="plain" size="icon-sm" aria-label="上一页" title="上一页" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
        <span aria-label={`第 ${currentPage + 1} 页`} aria-live="polite">{currentPage + 1}{loaded && cursor === null && ` / ${Math.max(1, Math.ceil(visible.length / PAGE_SIZE))}`}</span>
        <Button variant="plain" size="icon-sm" aria-label={loading ? '正在读取会话' : '下一页'} title="下一页" disabled={disabled || !hasNext} onClick={() => {
          if (cursor !== null && visible.length <= (currentPage + 2) * PAGE_SIZE) void load(cursor, currentPage + 1);
          else setPage(currentPage + 1);
        }}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ChevronRight />}</Button>
      </nav>}
    </>}
    <Dialog open={renaming !== null} onOpenChange={open => { if (!open && !state.busy) setRenaming(null); }}><DialogContent className="management-dialog" closeDisabled={state.busy}>
      <DialogTitle>重命名会话</DialogTitle><DialogDescription className="management-caption">{renaming?.cwd}</DialogDescription>
      <form onSubmit={e => { e.preventDefault(); if (!renaming || state.busy || !title.trim()) return;
        void state.run({ kind: 'session.rename', id: renaming.id, title: title.trim() }).then(result => {
          if (result.ok) { updateRow(renaming.id, { title: title.trim() }); setRenaming(null); }
        });
      }}><Input aria-label="会话标题" autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} disabled={state.busy} />
        {state.notice && !state.notice.ok && <p role="alert" className="management-caption text-destructive">{state.notice.message}</p>}
        <footer className="management-form-actions"><Button variant="plain" size="sm" disabled={state.busy} onClick={() => setRenaming(null)}>取消</Button><Button variant="outline" size="sm" type="submit" disabled={state.busy || !title.trim()}>保存</Button></footer>
      </form>
    </DialogContent></Dialog>
  </section>;
}
