import type { ClipboardEventHandler, DragEventHandler, ReactNode } from 'react';

export interface SideChatImage { readonly id: string; readonly name: string }

export interface SideToolActivity {
  readonly id: string;
  readonly name: string;
  readonly kind: 'read' | 'search' | 'web' | 'git' | 'analysis' | 'other';
  readonly state: 'running' | 'done' | 'error' | 'incomplete';
  readonly target?: string;
  readonly code?: string;
  readonly language?: 'javascript' | 'typescript';
  readonly output?: string;
  readonly error?: string;
  readonly detailsOmitted?: boolean;
}

/** Arrival order of one answer; text spans `answer` from `start` to the next text part. */
export type SideReplyPart =
  | { readonly kind: 'thinking'; readonly id: string; readonly text: string; readonly active: boolean; readonly truncated: boolean; readonly durationMs?: number }
  | { readonly kind: 'tool'; readonly id: string }
  | { readonly kind: 'text'; readonly start: number };

export interface SideConversation {
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'unsupported';
  readonly stopping?: boolean;
  readonly entries: readonly {
    readonly id: string;
    readonly question: string;
    readonly images?: readonly SideChatImage[];
    readonly answer: string;
    readonly parts?: readonly SideReplyPart[];
    readonly state: 'streaming' | 'done' | 'error';
    readonly stopped?: boolean;
    readonly progress?: 'waiting' | 'thinking' | 'tool' | 'answering';
    readonly tools?: readonly SideToolActivity[];
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
  readonly composerStatus?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly hasAttachments?: boolean;
  readonly sendDisabled?: boolean;
  readonly onPaste?: ClipboardEventHandler<HTMLElement>;
  readonly onDrop?: DragEventHandler;
  readonly onDragOver?: DragEventHandler;
  readonly renderImages?: (images: readonly SideChatImage[]) => ReactNode;
}
