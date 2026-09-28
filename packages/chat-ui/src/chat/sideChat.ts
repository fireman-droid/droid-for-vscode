import type { ClipboardEventHandler, DragEventHandler, ReactNode } from 'react';

export interface SideChatImage { readonly id: string; readonly name: string }

export interface SideConversation {
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'unsupported';
  readonly entries: readonly {
    readonly id: string;
    readonly question: string;
    readonly images?: readonly SideChatImage[];
    readonly answer: string;
    readonly thinking?: string;
    readonly thinkingTruncated?: boolean;
    readonly thinkingDurationMs?: number;
    readonly state: 'streaming' | 'done' | 'error';
    readonly progress?: 'waiting' | 'thinking' | 'tool' | 'answering';
    readonly message: string | null;
  }[];
  readonly message: string | null;
  readonly pendingQuestion: string | null;
  readonly pendingImages?: readonly SideChatImage[];
}

export interface SideChatProps {
  readonly state: SideConversation;
  readonly draft: string;
  readonly quote?: string | null;
  readonly quotes?: readonly string[];
  readonly notice?: string | null;
  readonly width: number;
  readonly maxTextLength: number;
  readonly onDraftChange: (draft: string) => void;
  readonly onQuoteClear: () => void;
  readonly onQuoteRemove?: (index: number) => void;
  readonly onWidthChange: (width: number) => void;
  readonly onDismiss: () => void;
  readonly onAsk: (text: string) => void;
  readonly onStop: () => void;
  readonly attachments?: ReactNode;
  readonly composerActions?: ReactNode;
  readonly hasAttachments?: boolean;
  readonly sendDisabled?: boolean;
  readonly onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onDrop?: DragEventHandler;
  readonly onDragOver?: DragEventHandler;
  readonly renderImages?: (images: readonly SideChatImage[]) => ReactNode;
}
