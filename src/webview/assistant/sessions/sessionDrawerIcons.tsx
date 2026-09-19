// Icons of the session-history popover. Moved verbatim from
// SessionDrawer.tsx (structure-only split for the line budget).

export function StarIcon({ filled }: { readonly filled: boolean }): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="m8 2.2 1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.19l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57L8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ForkIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4.5" cy="3.75" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="3.75" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="12.25" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4.5 5.5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-1M8 8.5v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RenameIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m11.1 2.6 2.3 2.3-7.6 7.6-3 .7.7-3 7.6-7.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArchiveIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.25"
        y="3"
        width="11.5"
        height="3"
        rx="0.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.25 6v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V6M6.5 8.75h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UnarchiveIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.25"
        y="3"
        width="11.5"
        height="3"
        rx="0.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.25 6v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V6M8 12v-4m0 0-1.75 1.75M8 8l1.75 1.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Completed-session mark: the quiet gray circle-check (spec §2.1). */
export function CheckCircleIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.4 8.2 1.8 1.8 3.4-3.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SessionIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 2v3.333h3.333M2.033 8.667a6 6 0 1 0 1.967-5.134l-2 1.8M8 4.667V8l2.333 1.333"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
