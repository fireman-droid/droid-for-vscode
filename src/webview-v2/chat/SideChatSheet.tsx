import type { ComponentProps } from 'react';
import { SideChatSheet as SideChatView } from '@droidvisx/chat-ui/chat/SideChatSheet';
import { MAX_BTW_TEXT_LENGTH, type SessionBtwState } from '../../shared/protocol/btwProtocol';
export function SideChatSheet({ state, ...props }: Omit<ComponentProps<typeof SideChatView>, 'state' | 'maxTextLength'> & { readonly state: SessionBtwState }) {
  return <SideChatView {...props} state={{ ...state, status: state.status === 'forking' ? 'preparing' : state.status }} maxTextLength={MAX_BTW_TEXT_LENGTH} />;
}
