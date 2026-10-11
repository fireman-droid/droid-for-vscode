import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Download, Folder, MoreHorizontal, RefreshCw, Search, Star } from 'lucide-react';
import type { ManagedSession, ManagementAction } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger } from '../ui/selection';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ManagementChoice } from './ManagementFields';
import type { ManagementState } from './useManagement';

export function SessionManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const [scope, setScope] = useState<'folder' | 'all'>('folder');
  const [kind, setKind] = useState('all');
  const [filter, setFilter] = useState('normal');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly ManagedSession[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ManagedSession | null>(null);
  const [title, setTitle] = useState('');
  const generation = useRef(0);
  const load = (next?: number) => {
    const revision = ++generation.current;
    setLoading(true); setLoaded(true); setError(null);
    void state.run({ kind: 'sessions.list', scope, ...(next === undefined ? {} : { cursor: next }) }).then(result => {
      if (generation.current !== revision) return;
      setLoading(false);
      if (!result.ok || !result.sessions) { setError(result.message || '会话目录读取失败'); return; }
      setRows(prev => next === undefined ? result.sessions! : [...new Map([...prev, ...result.sessions!].map(row => [row.id, row])).values()]);
      setCursor(result.nextCursor ?? null);
    });
  };
  useEffect(() => {
    if (active && state.settings?.sessionManagementAvailable && !state.busy && !loaded) load();
  }, [active, state.settings, state.busy, loaded]);
  const act = (action: ManagementAction, update?: Partial<ManagedSession>) => {
    void state.run(action).then(result => {
      if (result.ok && update && 'id' in action) setRows(prev => prev.map(row => row.id === action.id ? { ...row, ...update } : row));
    });
  };
  const visible = rows.filter(row => (kind === 'all' || row.kind === kind)
    && (filter === 'archived' ? row.archived : !row.archived && (filter !== 'favorites' || row.favorite))
    && `${row.title} ${row.cwd}`.toLowerCase().includes(query.toLowerCase()));
  const disabled = state.busy || loading;
  return <section aria-label="会话管理">
    <header className="management-heading"><div><h1>会话</h1><p>查看、导出和整理保存的记录</p></div><Button variant="plain" size="icon-sm" aria-label="刷新会话" disabled={disabled} onClick={() => load()}><RefreshCw /></Button></header>
    <div className="management-toolbar"><Tabs value={scope} onValueChange={value => { ++generation.current; setScope(value as 'folder' | 'all'); setRows([]); setCursor(null); setLoaded(false); setError(null); }}>
      <TabsList aria-label="会话范围"><TabsTrigger value="folder" disabled={disabled}>当前文件夹</TabsTrigger><TabsTrigger value="all" disabled={disabled}>全部文件夹</TabsTrigger></TabsList>
    </Tabs><div className="management-actions"><ManagementChoice label="会话类型" value={kind} onChange={setKind} options={[[ 'all', '聊天与 Exec' ], ['chat', '聊天'], ['exec', 'Exec']]} />
      <ManagementChoice label="收藏与归档" value={filter} onChange={setFilter} options={[[ 'normal', '未归档' ], ['favorites', '收藏'], ['archived', '已归档']]} /></div></div>
    <div className="management-search management-session-search"><Search /><Input aria-label="筛选会话" placeholder="搜索标题或文件夹" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="management-scope"><span><Folder />{scope === 'folder' ? state.settings?.cwd || '未打开文件夹' : '所有文件夹'}</span><small>已加载 {rows.length} 条</small></div>
    {!state.settings?.sessionManagementAvailable ? <p className="management-empty">会话管理需要 daemon 运行模式。</p> : <>
      {error && <p role="alert" className="management-caption text-destructive">{error}</p>}
      <div className="management-session-table">
        <div className="management-session-head"><span>标题</span><span>修改</span><span>消息数</span><span /></div>
        {visible.map(row => <div className="management-session-row" key={row.id}>
          <Button variant="plain" size="none" className="management-session-title" onClick={() => act({ kind: 'session.view', id: row.id })} disabled={disabled}>
            <span>{row.title}{row.favorite && <Star aria-label="已收藏" />}</span><small>{scope === 'all' ? row.cwd : row.kind === 'exec' ? 'Exec' : row.active ? '当前聊天' : '聊天'}</small>
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
      {loading ? <p className="management-empty" role="status">正在读取会话…</p> : visible.length === 0 && !error && <p className="management-empty">{cursor !== null ? '已加载记录中没有匹配项，可继续加载。' : '没有匹配的会话'}</p>}
      {cursor !== null && <Button variant="plain" size="sm" disabled={disabled} onClick={() => load(cursor)}>加载更多</Button>}
    </>}
    <Dialog open={renaming !== null} onOpenChange={open => { if (!open && !state.busy) setRenaming(null); }}><DialogContent className="management-dialog" closeDisabled={state.busy}>
      <DialogTitle>重命名会话</DialogTitle><DialogDescription className="management-caption">{renaming?.cwd}</DialogDescription>
      <form onSubmit={e => { e.preventDefault(); if (!renaming || state.busy || !title.trim()) return;
        void state.run({ kind: 'session.rename', id: renaming.id, title: title.trim() }).then(result => {
          if (result.ok) { setRows(prev => prev.map(row => row.id === renaming.id ? { ...row, title: title.trim() } : row)); setRenaming(null); }
        });
      }}><Input aria-label="会话标题" autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} disabled={state.busy} />
        {state.notice && !state.notice.ok && <p role="alert" className="management-caption text-destructive">{state.notice.message}</p>}
        <footer className="management-form-actions"><Button variant="plain" size="sm" disabled={state.busy} onClick={() => setRenaming(null)}>取消</Button><Button variant="outline" size="sm" type="submit" disabled={state.busy || !title.trim()}>保存</Button></footer>
      </form>
    </DialogContent></Dialog>
  </section>;
}
