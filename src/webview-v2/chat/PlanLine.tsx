import { PlanLine as PlanView } from '@droidvisx/chat-ui/chat/PlanLine';
import type { ComponentProps } from 'react';
import type { PlanAnchorState } from '../../webview/assistant/transcript/planAnchor';
export { PlanSteps } from '@droidvisx/chat-ui/chat/PlanLine';
export function PlanLine({ anchor, ...props }: Omit<ComponentProps<typeof PlanView>, 'anchor'> & { readonly anchor: PlanAnchorState }) {
  return <PlanView {...props} anchor={{ ...anchor, id: anchor.anchorToolUseId }} />;
}
