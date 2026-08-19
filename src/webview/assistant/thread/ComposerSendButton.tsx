import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";

import { SendIcon } from "./icons";

export function ComposerSendButton({
  onSend,
}: {
  readonly onSend?: () => void;
}): React.JSX.Element {
  const isEmpty = useAuiState((state) => state.composer.isEmpty);
  const props = {
    className: "dvx-composer-action dvx-send-action",
    "aria-label": "Send",
  } as const;
  return onSend === undefined ? (
    <ComposerPrimitive.Send {...props}>
      <SendIcon />
    </ComposerPrimitive.Send>
  ) : (
    <button type="button" {...props} disabled={isEmpty} onClick={onSend}>
      <SendIcon />
    </button>
  );
}
