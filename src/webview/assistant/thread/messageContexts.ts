import { createContext } from 'react';
import { type ChangesTranscriptItem } from '../../../shared/protocol/transcript';

// Tool rows deep inside the transcript open native diffs through this
// context so the memoized message tree stays free of prop drilling.
export const FileDiffContext = createContext<
  (path: string, turnId: string | null) => void
>(() => undefined);

export const ReviewTurnContext = createContext<(turnId: string) => void>(() => undefined);

// The latest turn's cumulative file counts stay available to deep tool
// rows even though the full ledger is rendered separately in ReviewDock.
export type ToolFileChange = ChangesTranscriptItem['files'][number];

export interface ToolChangesContextValue {
  readonly turnId: string | null;
  readonly filesByPath: ReadonlyMap<string, ToolFileChange>;
}

export const EMPTY_TOOL_CHANGES: ToolChangesContextValue = {
  turnId: null,
  filesByPath: new Map(),
};

export const ToolChangesContext =
  createContext<ToolChangesContextValue>(EMPTY_TOOL_CHANGES);

// Previewing an .html/.htm prototype opens the sandboxed preview panel
// through this context, matching the FileDiffContext pattern so deep
// Changes/Tool rows stay free of prop drilling. Exported for focused
// tests that assert chip visibility and wiring.
export const PreviewContext = createContext<(path: string) => void>(() => undefined);

// Live execute rows offer the read-only terminal mirror through this
// context (native-terminal design slice A). Null means the entry is
// unavailable and stays hidden. Exported for focused entry tests.
export const TerminalMirrorContext = createContext<(() => void) | null>(null);

// Regenerating rewinds to the last user message and resends it. Null
// means the action is currently unavailable (no anchor or turn active).
export const RegenerateContext = createContext<(() => void) | null>(null);

// Forking branches a new session from the current session state. The
// SDK forks only the present state (no per-message anchor), so the
// action appears solely on the last assistant message; null means it
// is unavailable (disconnected or a turn is active).
export const ForkContext = createContext<(() => void) | null>(null);

// The compaction divider offers a jump to the pre-compaction session
// through this context, keeping the memoized message tree free of
// prop drilling (same pattern as FileDiffContext).
export const SelectSessionContext = createContext<((sessionId: string) => void) | null>(
  null,
);
