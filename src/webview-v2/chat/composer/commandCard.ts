export * from '@droidvisx/chat-ui/chat/commandFormatting';
import { commandCardTitle as presentCommandTitle } from '@droidvisx/chat-ui/chat/commandFormatting';
import { resolveToolAction, summarizeToolAction } from '../../../shared/transcript/toolActivity';
export function commandCardTitle(action: string, toolName: string, command: string | null): string {
  return presentCommandTitle(resolveToolAction(toolName, action), summarizeToolAction(toolName), command);
}
