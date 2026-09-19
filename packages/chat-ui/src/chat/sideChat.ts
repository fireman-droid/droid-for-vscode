export interface SideConversation {
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'unsupported';
  readonly entries: readonly {
    readonly id: string;
    readonly question: string;
    readonly answer: string;
    readonly state: 'streaming' | 'done' | 'error';
    readonly message: string | null;
  }[];
  readonly message: string | null;
  readonly pendingQuestion: string | null;
}

export interface SideChatProps {
  readonly state: SideConversation;
  readonly draft: string;
  readonly quote: string | null;
  readonly width: number;
  readonly maxTextLength: number;
  readonly onDraftChange: (draft: string) => void;
  readonly onQuoteClear: () => void;
  readonly onWidthChange: (width: number) => void;
  readonly onDismiss: () => void;
  readonly onAsk: (text: string) => void;
  readonly onStop: () => void;
}
