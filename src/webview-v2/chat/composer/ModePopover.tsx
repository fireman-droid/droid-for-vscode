// The mode trigger's popover (Auto / Spec / Mission). Cursor menu
// form (spec §3.1): one icon-led single-line row per mode, the
// two-line descriptions retired into hover titles, the selected row
// keeps the thin accent check on the right (.dvx-radio-mark glyph).
// Selection side effects stay with the parent via onSelect.

import {
  type SessionInteractionMode,
  type SessionSettingsState,
} from '../../../shared/protocol/settings';
import { MODE_OPTIONS, SettingsStatus } from './shared';
import { RadioGroup, RadioGroupItem } from '../../ui/controls';

export function ModePopover({
  id,
  settings,
  shownMode,
  disabled,
  onSelect,
}: {
  readonly id: string;
  readonly settings: SessionSettingsState;
  /** Optimistically shown mode (useOptimisticSetting). */
  readonly shownMode: SessionInteractionMode;
  readonly disabled: boolean;
  readonly onSelect: (value: SessionInteractionMode) => void;
}): React.JSX.Element {
  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-mode-popover"
      role="dialog"
      aria-label="Mode"
    >
      <RadioGroup className="dvx-option-list" aria-label="Mode options" value={shownMode} disabled={disabled}
        onValueChange={(value) => onSelect(value as SessionInteractionMode)}>
        {MODE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="dvx-option-row dvx-mode-option"
            title={option.description}
          >
            <ModeIcon mode={option.value} />
            <span className="dvx-mode-option-label">{option.label}</span>
            <RadioGroupItem value={option.value} aria-label={option.label}
              onClick={() => { if (option.value === 'mission' && shownMode === 'mission') onSelect('mission'); }} />
          </label>
        ))}
      </RadioGroup>
      <SettingsStatus settings={settings} />
      {disabled && settings.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Mode can be changed after the current turn.
        </p>
      ) : null}
    </div>
  );
}

/** 14px linear glyphs: Auto = ∞, Spec = document+pen, Mission = flag. */
function ModeIcon({
  mode,
}: {
  readonly mode: SessionInteractionMode;
}): React.JSX.Element {
  if (mode === 'spec') {
    return (
      <svg
        className="dvx-mode-option-icon"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 2.5H5.2A1.2 1.2 0 0 0 4 3.7v8.6a1.2 1.2 0 0 0 1.2 1.2h5.6A1.2 1.2 0 0 0 12 12.3V5.5L9 2.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M9 2.5v3h3M6.4 9.1l3-3 1.2 1.2-3 3-1.5.3.3-1.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (mode === 'mission') {
    return (
      <svg
        className="dvx-mode-option-icon"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 13.5V2.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M4 3.2c2.6-1.3 5.4 1.3 8 0v5.6c-2.6 1.3-5.4-1.3-8 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      className="dvx-mode-option-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 8c-1.2 1.6-2.1 2.7-3.5 2.7a2.7 2.7 0 0 1 0-5.4C5.9 5.3 6.8 6.4 8 8Zm0 0c1.2-1.6 2.1-2.7 3.5-2.7a2.7 2.7 0 0 1 0 5.4C10.1 10.7 9.2 9.6 8 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
