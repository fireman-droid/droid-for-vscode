import { useEffect, useId, useRef } from 'react';

import { type PermissionInteractionRequest } from '../../../shared/protocol/interactions';

interface IndexedPermissionOption {
  readonly option: PermissionInteractionRequest['options'][number];
  readonly index: number;
}

export function PermissionAllowGroup({
  options,
  expanded,
  disabled,
  primaryLabel,
  menuLabel = 'More permission options',
  onExpandedChange,
  onEdit,
  onRespond,
}: {
  readonly options: readonly IndexedPermissionOption[];
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly primaryLabel?: string;
  readonly menuLabel?: string;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onEdit: (index: number) => void;
  readonly onRespond: (value: string) => void;
}): React.JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLastRef = useRef(false);
  const menuId = useId();
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button');
    items?.[focusLastRef.current ? items.length - 1 : 0]?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        onExpandedChange(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded, onExpandedChange]);

  const primary = options[0];
  if (primary === undefined) {
    return null;
  }
  const select = ({ option, index }: IndexedPermissionOption): void => {
    onExpandedChange(false);
    if (option.requiresEditedSpec) {
      onEdit(index);
      return;
    }
    onRespond(option.value);
  };

  return (
    <div
      ref={rootRef}
      className="dvx-permission-allow-group"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onExpandedChange(false);
        }
      }}
      onKeyDown={(event) => {
        if (!expanded) {
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onExpandedChange(false);
          triggerRef.current?.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
        ];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      }}
    >
      <button
        className="dvx-button dvx-button-primary dvx-permission-primary"
        type="button"
        disabled={disabled}
        onClick={() => select(primary)}
      >
        {primaryLabel ?? primary.option.label}
      </button>
      {options.length > 1 ? (
        <>
          <button
            ref={triggerRef}
            className="dvx-button dvx-button-primary dvx-permission-more"
            type="button"
            aria-label={menuLabel}
            aria-haspopup="menu"
            aria-controls={expanded ? menuId : undefined}
            aria-expanded={expanded}
            disabled={disabled}
            onKeyDown={(event) => {
              if (!expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                event.stopPropagation();
                focusLastRef.current = event.key === 'ArrowUp';
                onExpandedChange(true);
              }
            }}
            onClick={() => {
              focusLastRef.current = false;
              onExpandedChange(!expanded);
            }}
          >
            <svg
              className="dvx-permission-chevron"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m4.25 5.75 2.75 2.75 2.75-2.75"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {expanded ? (
            <div
              ref={menuRef}
              id={menuId}
              className="dvx-permission-menu"
              role="menu"
              aria-label={menuLabel}
            >
              {options.slice(1).map((option) => (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  key={option.index}
                  disabled={disabled}
                  onClick={() => select(option)}
                >
                  {option.option.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
