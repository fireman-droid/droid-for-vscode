import { useEffect, useMemo, useRef } from 'react';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import type { AssistantWebviewState } from '../../state/types';
import type { useSubagentPanelFlow } from './subagentPanelFlow';
import { selectWorkingSubagents } from './subagentWorking';

/** Inline activity follows the conversation, independently of its navigation UI. */
export function useWorkingSubagents(
  state: Pick<AssistantWebviewState, 'sessionId' | 'turn' | 'transcript'>,
  flow: Pick<ReturnType<typeof useSubagentPanelFlow>, 'onPanelToggle'>,
): readonly ToolTranscriptItem[] {
  const live = useRef({ sessionId: state.sessionId, turns: new Set<string>() });
  if (live.current.sessionId !== state.sessionId) live.current = { sessionId: state.sessionId, turns: new Set() };
  const turnId = state.turn?.turnId;
  if (turnId) live.current.turns.add(turnId);
  const working = useMemo(() => {
    const ids = new Set(selectWorkingSubagents(state.transcript, live.current.turns).map((item) => item.toolUseId));
    return state.transcript.filter((item): item is ToolTranscriptItem => item.kind === 'tool' && ids.has(item.toolUseId));
  }, [state.transcript, state.sessionId, turnId]);
  const present = working.length > 0;
  useEffect(() => {
    flow.onPanelToggle(present);
    return () => flow.onPanelToggle(false);
  }, [flow.onPanelToggle, present]);
  return working;
}
