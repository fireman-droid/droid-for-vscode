import { useEffect, useState } from 'react';
import type { PluginsPanelState, SkillsPanelState } from './composer/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/selection';

export function SkillsPanel({ skills, disabled, onRefresh, onToggle, onNewSession }: {
  readonly skills: SkillsPanelState;
  readonly disabled: boolean;
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, disabled: boolean) => void;
  readonly onNewSession: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (skills.status !== 'loading') setPending(null);
  }, [skills]);
  const busy = skills.status === 'loading' || pending !== null;
  const items = skills.items.filter((skill) => skill.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section aria-label="Skills" className="space-y-3 text-xs">
    <div className="flex items-center gap-2">
      <Input type="search" aria-label="Search skills" placeholder="Search skills" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Button variant="outline" size="sm" disabled={busy} onClick={onRefresh}>Refresh</Button>
    </div>
    {'message' in skills ? <p role={skills.status === 'error' ? 'alert' : 'status'} className="text-muted-foreground">{skills.message}</p> : null}
    {busy ? <p role="status" className="text-muted-foreground">{pending ? `Updating ${pending}…` : 'Loading skills…'}</p> : null}
    {skills.status === 'ready' && items.length === 0 ? <p role="status" className="text-muted-foreground">{skills.items.length === 0 ? 'No skills found.' : 'No matching skills.'}</p> : null}
    <ul className="space-y-3">
      {items.map((skill) => <li key={skill.name}>
        <label className="v2-chat-choice flex items-start gap-2 rounded">
          <Checkbox checked={skill.enabled} aria-label={`Enable ${skill.name}`} disabled={disabled || busy} onCheckedChange={(checked) => {
            setPending(skill.name);
            setChanged(true);
            onToggle(skill.name, checked !== true);
          }} />
          <span className="min-w-0 break-words">{skill.name}<span className="block text-muted-foreground">{skill.description}</span><span className="block text-[11px] text-muted-foreground">{skill.location}{skill.userInvocable ? ' · user invocable' : ''}</span></span>
        </label>
      </li>)}
    </ul>
    <p className="text-muted-foreground">Skill changes take effect in new sessions.</p>
    {changed ? <Button variant="outline" size="sm" disabled={disabled || busy} onClick={onNewSession}>Start a new session</Button> : null}
  </section>;
}

export function PluginsPanel({ plugins, onRefresh, onManage }: {
  readonly plugins: PluginsPanelState;
  readonly onRefresh: () => void;
  readonly onManage?: () => void;
}) {
  return <section aria-label="Plugins" className="space-y-3 text-xs">
    <Button variant="outline" size="sm" disabled={plugins.status === 'loading'} onClick={onRefresh}>Refresh</Button>
    {onManage ? <Button variant="outline" size="sm" onClick={onManage}>Manage plugins & marketplaces…</Button> : null}
    {plugins.status === 'loading' ? <p role="status" className="text-muted-foreground">Loading plugins…</p> : null}
    {'message' in plugins ? <p role={plugins.status === 'error' ? 'alert' : 'status'} className="text-muted-foreground">{plugins.message}</p> : null}
    <ul className="space-y-2">{plugins.items.map((plugin) => <li key={plugin.id} className="break-words">
      <p>{plugin.id}</p><p className="text-muted-foreground">{plugin.scope} · {plugin.version} · {plugin.active ? 'Active' : 'Off'}</p>
    </li>)}</ul>
    {plugins.status === 'ready' ? <p className="text-muted-foreground">{plugins.items.length === 0 ? 'No plugins installed. ' : ''}{plugins.marketplaceCount} marketplaces registered.</p> : null}
  </section>;
}
