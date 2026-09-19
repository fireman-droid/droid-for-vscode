import type { RefObject } from 'react';
import type { CommandSummary } from '../../../shared/protocol/settings';
import type { SlashEntry, SlashToken } from './composerCommands';
import type { SlashCommandsState } from './composerTypes';
import type { SlashNavTarget } from './slashBuiltins';
import { ComposerPopup } from './ComposerPopup';

interface SlashCommandPopupProps {
  readonly builtInMatches: readonly Pick<
    Extract<SlashEntry, { kind: 'builtin' }>,
    'name' | 'description'
  >[];
  readonly navMatches: readonly Pick<
    Extract<SlashEntry, { kind: 'nav' }>,
    'name' | 'description'
  >[];
  readonly commandMatches: readonly CommandSummary[];
  readonly skillMatches: readonly Pick<
    Extract<SlashEntry, { kind: 'skill' }>,
    'name' | 'description'
  >[];
  readonly slashIndex: number;
  readonly setSlashIndex: (index: number) => void;
  readonly selectSlashEntry: (entry: SlashEntry) => void;
  readonly selectSlashNav: (target: SlashNavTarget) => void;
  readonly selectCommand: (name: string) => void;
  readonly selectSkillGuide: (name: string) => void;
  readonly closeSlash: () => void;
  readonly slashPopupRef: RefObject<HTMLDivElement | null>;
  readonly commands: SlashCommandsState;
  readonly slash: SlashToken | null;
}

export function SlashCommandPopup({
  builtInMatches,
  navMatches,
  commandMatches,
  skillMatches,
  slashIndex,
  setSlashIndex,
  selectSlashEntry,
  selectSlashNav,
  selectCommand,
  selectSkillGuide,
  closeSlash,
  slashPopupRef,
  commands,
  slash,
}: SlashCommandPopupProps): React.JSX.Element {
  return (
    <ComposerPopup
      className="dvx-mention-popup dvx-command-popup"
      label="Droid commands"
      onDismiss={closeSlash}
      popupRef={slashPopupRef}
    >
      {builtInMatches.length + navMatches.length > 0 ? (
        <div className="dvx-command-section" role="presentation">
          Built-in
        </div>
      ) : null}
      {builtInMatches.map((command, index) => (
        <button
          key={`builtin:${command.name}`}
          type="button"
          role="option"
          aria-selected={index === slashIndex}
          className={`dvx-mention-item${
            index === slashIndex ? ' dvx-mention-active' : ''
          }`}
          onMouseDown={(event) => {
            // Keep focus in the textarea while selecting.
            event.preventDefault();
            selectSlashEntry({ kind: 'builtin', ...command });
          }}
          onMouseEnter={() => setSlashIndex(index)}
        >
          <span className="dvx-command-name">/{command.name}</span>
          <span className="dvx-command-desc">{command.description}</span>
        </button>
      ))}
      {navMatches.map((command, index) => (
        <button
          key={`nav:${command.name}`}
          type="button"
          role="option"
          aria-selected={builtInMatches.length + index === slashIndex}
          className={`dvx-mention-item${
            builtInMatches.length + index === slashIndex ? ' dvx-mention-active' : ''
          }`}
          onMouseDown={(event) => {
            // Keep focus in the textarea while selecting.
            event.preventDefault();
            selectSlashNav(command.name);
          }}
          onMouseEnter={() => setSlashIndex(builtInMatches.length + index)}
        >
          <span className="dvx-command-name">/{command.name}</span>
          <span className="dvx-command-desc">{command.description}</span>
        </button>
      ))}
      {commandMatches.length > 0 ? (
        <div className="dvx-command-section" role="presentation">
          Commands (.factory/commands)
        </div>
      ) : null}
      {commandMatches.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={builtInMatches.length + navMatches.length + index === slashIndex}
          className={`dvx-mention-item${
            builtInMatches.length + navMatches.length + index === slashIndex
              ? ' dvx-mention-active'
              : ''
          }`}
          onMouseDown={(event) => {
            // Keep focus in the textarea while selecting.
            event.preventDefault();
            selectCommand(command.name);
          }}
          onMouseEnter={() =>
            setSlashIndex(builtInMatches.length + navMatches.length + index)
          }
        >
          <span className="dvx-command-name">/{command.name}</span>
          {command.argumentHint !== null ? (
            <span className="dvx-command-hint">{command.argumentHint}</span>
          ) : null}
          {command.description !== null ? (
            <span className="dvx-command-desc">{command.description}</span>
          ) : null}
        </button>
      ))}
      {commandMatches.length === 0 &&
      (slash?.query.length === 0 ||
        builtInMatches.length + navMatches.length + skillMatches.length === 0) ? (
        <div className="dvx-command-status" role="status">
          {commands.status === 'loading'
            ? 'Loading commands…'
            : commands.status === 'error'
              ? commands.message
              : slash !== null && slash.query.length === 0
                ? 'No custom commands (.factory/commands)'
                : 'No matching commands'}
        </div>
      ) : null}
      {skillMatches.length > 0 ? (
        <div className="dvx-command-section" role="presentation">
          Skills (inserts a prompt)
        </div>
      ) : null}
      {skillMatches.map((skill, index) => (
        <button
          key={`skill:${skill.name}`}
          type="button"
          role="option"
          aria-selected={
            builtInMatches.length + navMatches.length + commandMatches.length + index ===
            slashIndex
          }
          className={`dvx-mention-item${
            builtInMatches.length + navMatches.length + commandMatches.length + index ===
            slashIndex
              ? ' dvx-mention-active'
              : ''
          }`}
          onMouseDown={(event) => {
            // Keep focus in the textarea while selecting.
            event.preventDefault();
            selectSkillGuide(skill.name);
          }}
          onMouseEnter={() =>
            setSlashIndex(
              builtInMatches.length + navMatches.length + commandMatches.length + index,
            )
          }
        >
          <span className="dvx-command-name">{skill.name}</span>
          {skill.description !== null ? (
            <span className="dvx-command-desc">{skill.description}</span>
          ) : null}
        </button>
      ))}
    </ComposerPopup>
  );
}
