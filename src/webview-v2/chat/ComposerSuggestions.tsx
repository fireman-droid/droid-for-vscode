import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AssistantWebviewState } from '../state/types';
import { createTurnId } from '../host/chatIntent';
import { findMentionToken, findSlashToken, getSlashMatches, splitMentionPath, type MentionToken, type SlashEntry, type SlashToken } from './composer/composerCommands';
import { CANVAS_REQUEST_TEMPLATE, type SlashNavTarget } from './composer/slashBuiltins';
import { PopoverContent } from '../ui/overlays';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';
import { SkillSuggestion } from './composer/SkillSuggestion';

export function useComposerSuggestions({ state, draft, disabled, onChange, onFileSearch, onAttachPath, onCommandsRefresh, onSkillsRefresh, onNavigate, onBtwOpen }: {
  readonly state: Pick<AssistantWebviewState, 'fileSearch' | 'commands' | 'skills' | 'btwAvailable'>;
  readonly draft: string;
  readonly disabled: boolean;
  readonly onChange: (text: string) => void;
  readonly onFileSearch: (id: string, query: string) => void;
  readonly onAttachPath: (path: string) => void;
  readonly onCommandsRefresh: () => void;
  readonly onSkillsRefresh: () => void;
  readonly onNavigate: (page: SlashNavTarget) => void;
  readonly onBtwOpen: () => void;
}) {
  const listId = useId();
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [index, setIndex] = useState(0);
  const [request, setRequest] = useState<string | null>(null);
  const dismiss = () => { setMention(null); setSlash(null); setRequest(null); setIndex(0); };
  const change = (value: string, caret: number) => {
    onChange(value);
    setMention(disabled ? null : findMentionToken(value, caret));
    setSlash(disabled ? null : findSlashToken(value, caret));
    setRequest(null);
    setIndex(0);
  };
  useEffect(() => {
    if (mention === null || disabled) return;
    const timer = setTimeout(() => {
      const id = `file-search-${createTurnId()}`;
      setRequest(id);
      onFileSearch(id, mention.query);
    }, mention.query.length === 0 ? 0 : 150);
    return () => clearTimeout(timer);
  }, [mention, disabled, onFileSearch]);
  const slashOpen = slash !== null && !disabled;
  const catalog = useRef({ state, onCommandsRefresh, onSkillsRefresh });
  catalog.current = { state, onCommandsRefresh, onSkillsRefresh };
  useEffect(() => {
    if (!slashOpen) return;
    const current = catalog.current;
    if (current.state.commands.status === 'idle' || current.state.commands.status === 'error') current.onCommandsRefresh();
    if (current.state.skills.status === 'idle') current.onSkillsRefresh();
  }, [slashOpen]);
  const matches = getSlashMatches(state.commands, state.skills.items, slash, state.btwAvailable, true);
  const results = mention !== null && request !== null && state.fileSearch?.requestId === request ? state.fileSearch.files : [];
  const searchPending = mention !== null && (request === null || state.fileSearch?.requestId !== request);
  const activeIndex = Math.max(0, Math.min(index, (slash !== null ? matches.entries.length : results.length) - 1));
  const selectSlash = (entry: SlashEntry) => {
    if (slash === null) return;
    const name = entry.kind === 'command' ? entry.command.name : entry.name;
    const navigate = entry.kind === 'nav';
    const btw = entry.kind === 'builtin' && entry.name === 'btw';
    const prefix = navigate || btw ? '' : entry.kind === 'skill' ? `Use the "${entry.name}" skill: `
      : entry.kind === 'builtin' && entry.name === 'canvas' ? CANVAS_REQUEST_TEMPLATE : `/${name} `;
    onChange(prefix + draft.slice(slash.end));
    dismiss();
    if (navigate) onNavigate(entry.name);
    if (btw) onBtwOpen();
  };
  const selectMention = (path: string) => {
    if (mention === null) return;
    onAttachPath(path);
    onChange(draft.slice(0, mention.start) + draft.slice(mention.end));
    dismiss();
  };
  const open = !disabled && (slash !== null || mention !== null);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return true; }
    const count = slash !== null ? matches.entries.length : results.length;
    if (count > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setIndex((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      return true;
    }
    if (!event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
      if (count === 0 && event.key === 'Tab') return false;
      event.preventDefault();
      if (count > 0) {
        if (slash !== null) selectSlash(matches.entries[activeIndex]);
        else selectMention(results[activeIndex]);
      }
      return true;
    }
    return false;
  };
  const activeId = (slash !== null ? matches.entries.length : results.length) > 0 ? `${listId}-${activeIndex}` : undefined;
  return { open, listId, activeId, slash, mention, matches, results, searchPending, activeIndex, setIndex, dismiss, change, onKeyDown, selectSlash, selectMention, request };
}

export function ComposerSuggestions({ suggestions, state }: {
  readonly suggestions: ReturnType<typeof useComposerSuggestions>;
  readonly state: Pick<AssistantWebviewState, 'fileSearch' | 'commands'>;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ name: string; mode: 'hover' | 'pinned' } | null>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [suggestions.activeIndex]);
  const { slash, mention, matches, results, activeIndex, searchPending } = suggestions;
  useEffect(() => {
    if (preview !== null && (slash === null || !matches.entries.some((entry) => entry.kind === 'skill' && entry.name === preview.name))) setPreview(null);
  }, [slash, matches.entries, preview]);
  const hoverPreview = (name: string, open: boolean) => setPreview((current) => {
    if (current?.mode === 'pinned') return current;
    return open ? { name, mode: 'hover' } : current?.name === name ? null : current;
  });
  const pinPreview = (name: string, open: boolean) => setPreview((current) =>
    open ? { name, mode: 'pinned' } : current?.name === name ? null : current);
  return <PopoverContent side="top" sideOffset={6} className="w-[var(--radix-popover-trigger-width,320px)] p-1"
    onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
    onInteractOutside={(event) => { if (event.target instanceof Element && event.target.closest('[data-composer-input], [data-suggestion-preview]')) event.preventDefault(); }}>
    <div ref={list} id={suggestions.listId} role="listbox" aria-label={slash !== null ? 'Droid commands' : 'Attach workspace file'} className="max-h-60 overflow-auto">
      {slash !== null ? matches.entries.map((entry, index) => {
        const name = entry.kind === 'command' ? entry.command.name : entry.name;
        const description = entry.kind === 'command' ? entry.command.description : entry.description;
        const previous = matches.entries[index - 1];
        const group = (value: SlashEntry) => value.kind === 'nav' ? 'builtin' : value.kind;
        return <div key={`${entry.kind}:${name}`}>
          {previous === undefined || group(previous) !== group(entry) ? <p className="px-2 py-1 text-[10px] text-muted-foreground">{entry.kind === 'command' ? 'Commands (.factory/commands)' : entry.kind === 'skill' ? 'Skills (inserts a prompt)' : 'Built-in'}</p> : null}
          {entry.kind === 'skill' && description ? <SkillSuggestion id={`${suggestions.listId}-${index}`}
            name={name} description={description} selected={index === activeIndex}
            preview={preview?.name === name ? preview.mode : null}
            onHoverChange={(open) => hoverPreview(name, open)} onPinnedChange={(open) => pinPreview(name, open)}
            onActivate={() => suggestions.setIndex(index)} onSelect={() => suggestions.selectSlash(entry)} />
          : <Button variant="plain" size="none" id={`${suggestions.listId}-${index}`} role="option" aria-selected={index === activeIndex} tabIndex={-1} title={description ?? undefined}
            className={cn('block w-full rounded px-2 py-1 text-left text-xs outline-none hover:bg-[var(--control-surface-hover)] focus-visible:ring-1 focus-visible:ring-ring', index === activeIndex && 'bg-[var(--control-surface-active)]')}
            onMouseDown={(event) => event.preventDefault()} onClick={() => suggestions.selectSlash(entry)} onMouseEnter={() => suggestions.setIndex(index)}>
            <span>{entry.kind === 'skill' ? name : `/${name}`}</span>
            {entry.kind === 'command' && entry.command.argumentHint ? <span className="ml-2 text-muted-foreground">{entry.command.argumentHint}</span> : null}
            {description ? <span className="block truncate text-[11px] text-muted-foreground">{description}</span> : null}
          </Button>}
        </div>;
      }) : <>
        {mention?.query === '' && results.length > 0 ? <p className="px-2 py-1 text-[10px] text-muted-foreground">Open editors</p> : null}
        {results.map((path, index) => {
          const split = splitMentionPath(path);
          return <Button key={path} variant="plain" size="none" id={`${suggestions.listId}-${index}`} role="option" aria-selected={index === activeIndex} tabIndex={-1} title={path}
            className={cn('flex w-full min-w-0 gap-2 rounded px-2 py-1 text-left text-xs outline-none hover:bg-[var(--control-surface-hover)] focus-visible:ring-1 focus-visible:ring-ring', index === activeIndex && 'bg-[var(--control-surface-active)]')}
            onMouseDown={(event) => event.preventDefault()} onClick={() => suggestions.selectMention(path)} onMouseEnter={() => suggestions.setIndex(index)}>
            <span className="truncate">{split.name}</span><span className="min-w-0 truncate text-muted-foreground">{split.directory}</span>
          </Button>;
        })}
        {results.length === 0 ? <p role="status" className="p-2 text-xs text-muted-foreground">{searchPending ? 'Searching files…'
          : state.fileSearch?.status === 'no-workspace' ? 'No folder is open in this window.'
          : mention?.query === '' ? 'No open editors — type to search files' : 'No matching files'}</p> : null}
      </>}
      {slash !== null && matches.commandMatches.length === 0 && (slash.query === '' || matches.entries.length === 0) ? <p role="status" className="p-2 text-xs text-muted-foreground">
        {state.commands.status === 'loading' ? 'Loading commands…' : state.commands.status === 'error' ? state.commands.message
          : slash.query === '' ? 'No custom commands (.factory/commands)' : 'No matching commands'}
      </p> : null}
    </div>
  </PopoverContent>;
}
