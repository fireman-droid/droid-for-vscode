import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react';
export interface ReviewFile { readonly path: string; readonly status: string; readonly changeKind?: string; readonly additions: number | null; readonly deletions: number | null }
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/selection';
import { Slider } from '../ui/controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
export function ReviewFiles({ files, selected, onSelect }: {
  files: readonly ReviewFile[]; selected: string | null; onSelect(path: string): void;
}) {
  const [filter, setFilter] = useState('');
  const [tree, setTree] = useState(true);
  const [unreviewed, setUnreviewed] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState<number | undefined>();
  const filtered = useMemo(() => files.filter((file) =>
    file.path.toLowerCase().includes(filter.toLowerCase()) && (!unreviewed || file.status !== 'reviewed')), [files, filter, unreviewed]);
  const groups = useMemo(() => {
    const value = new Map<string, ReviewFile[]>();
    for (const file of filtered) {
      const directory = tree ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      const key = tree && file.path.includes('/') ? directory : '';
      value.set(key, [...(value.get(key) ?? []), file]);
    }
    return [...value];
  }, [filtered, tree]);
  return <aside className="review-files" aria-label="Changed files" style={width ? { width } : undefined}>
    <div className="review-files-title"><strong>Changes <span>{filtered.length === files.length ? files.length : `${filtered.length} / ${files.length}`}</span></strong>
      <Button variant="ghost" size="sm" onClick={() => setTree(!tree)} title="Switch file layout">{tree ? 'List' : 'Tree'}</Button>
    </div>
    <Input className="mx-2.5 w-auto" type="search" aria-label="Filter files" placeholder="Filter files…" value={filter} onChange={(event) => setFilter(event.target.value)} />
    <label className="review-unreviewed"><Checkbox checked={unreviewed} onCheckedChange={(checked) => setUnreviewed(checked === true)} />Unreviewed only</label>
    <div className="review-file-list">
      {groups.map(([directory, rows]) => <Collapsible key={directory} open={!collapsed.has(directory)} onOpenChange={(open) => setCollapsed((old) => {
        const next = new Set(old); if (open) next.delete(directory); else next.add(directory); return next;
      })}>
        {directory ? <CollapsibleTrigger asChild><Button variant="plain" size="none" className="review-directory">
          {collapsed.has(directory) ? <ChevronRight /> : <ChevronDown />}<Folder /><span title={directory}>{directory}</span>
        </Button></CollapsibleTrigger> : null}
        <CollapsibleContent>{rows.map((file) => <Button key={file.path} variant="plain" size="none" className="review-file"
          data-review-status={file.status} aria-current={selected === file.path ? 'true' : undefined} onClick={() => onSelect(file.path)} title={file.path}>
          {file.status === 'reviewed' ? <Check className="review-file-check" /> : <FileCode2 />}
          <span className="review-file-name">{tree ? file.path.split('/').at(-1) : file.path}
            {file.status === 'changed-after-review' ? <small>Changed since review</small> : null}
          </span>
          {file.changeKind ? <span className="review-file-kind" title={file.changeKind}>{file.changeKind === 'untracked' ? 'U' : file.changeKind[0]!.toUpperCase()}</span> : null}
          <span className="review-file-stats"><i>{file.additions === null ? '' : `+${file.additions}`}</i><b>{file.deletions === null ? '' : `−${file.deletions}`}</b></span>
        </Button>)}</CollapsibleContent>
      </Collapsible>)}
      {!filtered.length ? <p className="review-empty">{files.length === 0 ? 'No changed files in this scope.' : 'No matching files.'}
        {files.length > 0 ? <Button variant="link" size="sm" onClick={() => { setFilter(''); setUnreviewed(false); }}>Clear filters</Button> : null}
      </p> : null}
    </div>
    <Slider className="review-file-width" aria-label="File sidebar width" min={180} max={440} step={10} value={[width ?? 240]} onValueChange={([value]) => setWidth(value)} />
  </aside>;
}
