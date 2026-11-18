import type { ReactNode, Ref } from 'react';
import { CommandCard as CommandView } from '@droidvisx/chat-ui/chat/CommandCard';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { commandCardTitle, commandChips } from './composer/commandCard';
import { formatDuration, formatToolLifecycle } from './thread/readers';
import { executionLabel } from '../content/operationPresentation';

export function CommandCard({ item, command, output, open, onOpenChange, fileActions, buttonRef, contentRef }: {
  readonly item: ToolTranscriptItem;
  readonly command: string;
  readonly output: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: () => void;
  readonly fileActions: ReactNode;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly contentRef?: Ref<HTMLDivElement>;
}) {
  const title = commandCardTitle(item.action, item.toolName, command);
  const rawChips = commandChips(command).filter((chip) => chip !== title && !title.startsWith(`${chip} `) && chip !== item.target);
  const normalizedCommand = command.trim();
  const singleLine = !normalizedCommand.includes('\n');
  const showCommandInline = rawChips.length <= 1 && singleLine && !item.target && title !== normalizedCommand && !normalizedCommand.startsWith(`${title} `);
  const chips = rawChips.length > 1 ? rawChips : [];
  const target = item.target ?? (showCommandInline ? normalizedCommand : undefined);
  const phase = executionLabel(item);
  const status = item.status === 'completed' && !phase ? undefined : [phase ?? (item.status === 'stopping' ? 'Stopping' : formatToolLifecycle(item.status)), item.durationMs === undefined ? '' : formatDuration(item.durationMs)].filter(Boolean).join(' · ');
  return <CommandView title={title} target={target} chips={chips} running={item.status === 'running'} failed={item.status === 'failed'} statusLabel={status}
    command={command} output={output} open={open} onOpenChange={onOpenChange} fileActions={fileActions} buttonRef={buttonRef} contentRef={contentRef} />;
}
