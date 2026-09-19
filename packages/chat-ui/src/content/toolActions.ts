import { createContext, useContext } from 'react';
import type { PathLink } from '../markdown/pathLink';

export interface ToolActions {
  readonly openPath?: (link: PathLink) => void;
  readonly openFileDiff?: (path: string, turnId: string) => void;
  readonly openReviewTurn?: (turnId: string) => void;
  readonly openTerminalMirror?: () => void;
  readonly openSubagent?: (turnId: string, toolUseId: string) => void;
}

export const ToolActionsContext = createContext<ToolActions>({});
export const useToolActions = () => useContext(ToolActionsContext);
