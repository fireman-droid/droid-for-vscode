import { PinwheelIcon } from '@droidvisx/chat-ui/ui/pinwheel-icon';

/** Version details live in Management; the chat header stays a quiet label. */
export function AppInfo() {
  return <span className="inline-flex h-6 items-center gap-1.5 text-[13px] font-medium"><PinwheelIcon className="size-4 shrink-0" />Droid</span>;
}
