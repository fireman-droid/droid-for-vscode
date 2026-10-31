import { MAX_BTW_THINKING_BLOCKS, MAX_BTW_THINKING_LENGTH } from '../../shared/protocol/btwProtocol';

export interface BtwThinkingBlock {
  readonly id: string;
  readonly text: string;
  readonly active: boolean;
  readonly truncated: boolean;
  readonly durationMs?: number;
}

/** Every retained block in first-seen order, so consumers can place each one where it began. */
export interface BtwThinkingEvent {
  readonly kind: 'thinking';
  readonly blocks: readonly BtwThinkingBlock[];
}

interface ThinkingBlock {
  readonly id: string;
  text: string;
  complete: boolean;
  truncated: boolean;
  durationMs?: number;
}

/** One question's SDK thinking blocks, shared by process notifications and daemon streams. */
export class BtwThinkingProjection {
  private readonly messages = new Map<string, Map<number, ThinkingBlock>>();
  private readonly order: ThinkingBlock[] = [];
  private retainedLength = 0;

  project(event: {
    readonly type?: unknown;
    readonly messageId?: unknown;
    readonly blockIndex?: unknown;
    readonly text?: unknown;
    readonly durationMs?: unknown;
    readonly message?: unknown;
  }): BtwThinkingEvent | null {
    if (event.type === 'thinking_text_delta' || event.type === 'thinking_text_complete') {
      const block = this.block(event.messageId, event.blockIndex);
      if (!block) return null;
      if (event.type === 'thinking_text_delta') {
        if (block.complete) return null;
        if (typeof event.text === 'string') this.setText(block, block.text + event.text);
      } else {
        block.complete = true;
        this.setDuration(block, event.durationMs);
      }
      return this.snapshot();
    }
    if (event.type !== 'assistant' && event.type !== 'create_message') return null;
    const message = event.message;
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) return null;
    let changed = false;
    message.content.forEach((content: unknown, index: number) => {
      if (!isRecord(content) || content.type !== 'thinking') return;
      const block = this.block(message.id, index);
      if (!block) return;
      // A completed message reconciles the same block instead of appending it a second time.
      if (typeof content.thinking === 'string' && content.thinking.length > 0) this.setText(block, content.thinking);
      block.complete = true;
      this.setDuration(block, content.durationMs);
      changed = true;
    });
    return changed ? this.snapshot() : null;
  }

  private block(messageId: unknown, index: unknown): ThinkingBlock | null {
    if (typeof messageId !== 'string' || !messageId || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return null;
    let message = this.messages.get(messageId);
    if (!message) { message = new Map(); this.messages.set(messageId, message); }
    let block = message.get(index);
    if (!block) {
      if (this.order.length >= MAX_BTW_THINKING_BLOCKS) return null;
      block = { id: `thinking-${this.order.length}`, text: '', complete: false, truncated: false };
      message.set(index, block);
      this.order.push(block);
    }
    return block;
  }

  private setText(block: ThinkingBlock, text: string): void {
    const available = MAX_BTW_THINKING_LENGTH - this.retainedLength + block.text.length;
    const next = text.slice(0, available);
    this.retainedLength += next.length - block.text.length;
    block.text = next;
    block.truncated ||= text.length > available;
  }

  private setDuration(block: ThinkingBlock, duration: unknown): void {
    if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= Number.MAX_SAFE_INTEGER) block.durationMs = duration;
  }

  private snapshot(): BtwThinkingEvent {
    return { kind: 'thinking', blocks: this.order.map((block) => ({
      id: block.id, text: block.text, active: !block.complete, truncated: block.truncated,
      ...(block.durationMs === undefined ? {} : { durationMs: block.durationMs }),
    })) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
