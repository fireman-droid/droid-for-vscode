import { useMemo, type ComponentProps } from 'react';
import { SessionMenu as SessionMenuView } from '@droidvisx/chat-ui/chat/SessionMenu';
import type { AssistantWebviewState } from '../state/types';
import { MAX_SESSION_SEARCH_QUERY_LENGTH, MAX_SESSION_TITLE_LENGTH } from '../../shared/protocol/bounds';
export function SessionMenu({ state, ...props }: Omit<ComponentProps<typeof SessionMenuView>, 'state'> & { readonly state: AssistantWebviewState }) {
  const sessions = useMemo(() => ({ ...state.sessions, items: state.sessions.items.map((item) => ({ ...item, badge: item.missionRole ? item.missionRole === 'worker' ? 'mission · worker' : 'mission' : undefined })) }), [state.sessions]);
  return <SessionMenuView {...props} state={{ sessions, archived: state.archived, sessionSearch: state.sessionSearch, worktreeCreateAvailable: state.worktreeCreateAvailable }} maxSearchLength={MAX_SESSION_SEARCH_QUERY_LENGTH} maxTitleLength={MAX_SESSION_TITLE_LENGTH} />;
}
