import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Key } from 'react';
import { Check, ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react';
export interface ReviewFile { readonly path: string; readonly status: string; readonly changeKind?: string; readonly additions: number | null; readonly deletions: number | null }
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/selection';
import { Slider } from '../ui/controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { useVirtualList } from '../ui/useVirtualList';
type FileRow = { readonly key: string; readonly directory: string; readonly file?: ReviewFile };
type VisibleRow = { readonly key: Key; readonly index: number; readonly start: number };
export const ReviewFiles = memo(function ReviewFiles({ files, selected, onSelect }: {
  files: readonly ReviewFile[]; selected: string | null; onSelect(path: string): void;
}) {
  const [filter, setFilter] = useState('');
  const [tree, setTree] = useState(true);
  const [unreviewed, setUnreviewed] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState<number | undefined>();
  const query = useDeferredValue(filter.toLowerCase());
  const previousFilter = useRef({ query, unreviewed, tree });
  const filtered = useMemo(() => files.filter((file) =>
    file.path.toLowerCase().includes(query) && (!unreviewed || file.status !== 'reviewed')), [files, query, unreviewed]);
  const groups = useMemo(() => {
    const value = new Map<string, ReviewFile[]>();
    for (const file of filtered) {
      const directory = tree ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      const key = tree && file.path.includes('/') ? directory : '';
      const rows = value.get(key);
      if (rows) rows.push(file); else value.set(key, [file]);
    }
    return [...value];
  }, [filtered, tree]);
  const rows = useMemo(() => groups.flatMap(([directory, files]): FileRow[] => [
    ...(directory ? [{ key: `directory:${directory}`, directory }] : []),
    ...(!directory || !collapsed.has(directory) ? files.map((file) => ({ key: `file:${file.path}`, directory, file })) : []),
  ]), [groups, collapsed]);
  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const virtual = rows.length > 200;
  const list = useVirtualList({ keys, enabled: virtual, revealKey: selected ? `file:${selected}` : null,
    estimateSize: (index) => rows[index]?.file?.status === 'changed-after-review' ? 46 : 33 });
  useLayoutEffect(() => {
    if (!selected || !tree) return;
    const directory = selected.slice(0, selected.lastIndexOf('/'));
    setCollapsed((old) => {
      if (!old.has(directory)) return old;
      const next = new Set(old); next.delete(directory); return next;
    });
  }, [selected, tree]);
  useLayoutEffect(() => {
    const previous = previousFilter.current;
    if (previous.query !== query || previous.unreviewed !== unreviewed || previous.tree !== tree) {
      if (list.viewport.current) list.viewport.current.scrollTop = 0;
      previousFilter.current = { query, unreviewed, tree };
    }
  }, [query, unreviewed, tree, list.viewport]);
  const visible: VisibleRow[] = virtual ? list.virtualizer.getVirtualItems() : rows.map((row, index) => ({ key: row.key, index, start: 0 }));
  const visibleGroups = new Map<string, VisibleRow[]>();
  for (const item of visible) {
    const directory = rows[item.index]!.directory;
    const group = visibleGroups.get(directory);
    if (group) group.push(item); else visibleGroups.set(directory, [item]);
  }
  const rowProps = (item: (typeof visible)[number]) => ({
    'data-index': item.index, 'data-virtual-row': item.index,
    ref: virtual ? list.virtualizer.measureElement : undefined,
    style: { display: 'flow-root', ...(virtual ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` } : {}) } as CSSProperties,
  });
  return <aside className="review-files" aria-label="Changed files" style={width ? { width } : undefined}>
    <div className="review-files-title"><strong>Changes <span>{filtered.length === files.length ? files.length : `${filtered.length} / ${files.length}`}</span></strong>
      <Button variant="ghost" size="sm" onClick={() => setTree(!tree)} title="Switch file layout">{tree ? 'List' : 'Tree'}</Button>
    </div>
    <Input className="mx-2.5 w-auto" type="search" aria-label="Filter files" placeholder="Filter files…" value={filter} onChange={(event) => setFilter(event.target.value)} />
    <label className="review-unreviewed"><Checkbox checked={unreviewed} onCheckedChange={(checked) => setUnreviewed(checked === true)} />Unreviewed only</label>
    <div className="review-file-list" ref={list.viewport} onKeyDown={list.onKeyDown} onFocusCapture={list.onFocusCapture} onBlurCapture={list.onBlurCapture}>
      <div style={virtual ? { position: 'relative', height: list.virtualizer.getTotalSize() } : undefined}>
      {[...visibleGroups].map(([directory, items]) => <Collapsible key={directory} open={!directory || !collapsed.has(directory)} onOpenChange={(open) => setCollapsed((old) => {
        const next = new Set(old); if (open) next.delete(directory); else next.add(directory); return next;
      })}>
        {items.filter((item) => !rows[item.index]!.file).map((item) => <div key={item.key} {...rowProps(item)}><CollapsibleTrigger asChild><Button variant="plain" size="none" className="review-directory">
          {collapsed.has(directory) ? <ChevronRight /> : <ChevronDown />}<Folder /><span title={directory}>{directory}</span>
        </Button></CollapsibleTrigger></div>)}
        <CollapsibleContent>{items.filter((item) => rows[item.index]!.file).map((item) => {
          const file = rows[item.index]!.file!;
          return <div key={item.key} {...rowProps(item)}><Button variant="plain" size="none" className="review-file"
          data-review-status={file.status} aria-current={selected === file.path ? 'true' : undefined} onClick={() => onSelect(file.path)} title={file.path}>
          {file.status === 'reviewed' ? <Check className="review-file-check" /> : <FileCode2 />}
          <span className="review-file-name">{tree ? file.path.split('/').at(-1) : file.path}
            {file.status === 'changed-after-review' ? <small>Changed since review</small> : null}
          </span>
          {file.changeKind ? <span className="review-file-kind" title={file.changeKind}>{file.changeKind === 'untracked' ? 'U' : file.changeKind[0]!.toUpperCase()}</span> : null}
          <span className="review-file-stats"><i>{file.additions === null ? '' : `+${file.additions}`}</i><b>{file.deletions === null ? '' : `−${file.deletions}`}</b></span>
        </Button></div>;
        })}</CollapsibleContent>
      </Collapsible>)}
      </div>
      {!filtered.length ? <p className="review-empty">{files.length === 0 ? 'No changed files in this scope.' : 'No matching files.'}
        {files.length > 0 ? <Button variant="link" size="sm" onClick={() => { setFilter(''); setUnreviewed(false); }}>Clear filters</Button> : null}
      </p> : null}
    </div>
    <Slider className="review-file-width" aria-label="File sidebar width" min={180} max={440} step={10} value={[width ?? 240]} onValueChange={([value]) => setWidth(value)} />
  </aside>;
});
