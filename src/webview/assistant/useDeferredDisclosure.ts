import { useEffect, useState } from "react";

/**
 * Lazy-mounts a disclosure body only once the reader opens it, then
 * keeps it mounted (collapsed via CSS) so later toggles animate in
 * both directions. Mounting and opening in the same commit paints
 * the body already at its open size with no prior frame to
 * transition from (2026-08-19 user report: first click had no
 * animation), so `open` lags `mounted` by one animation frame; a
 * later close is applied immediately since the element is already
 * on screen and has a real closed frame to animate from.
 */
export function useDeferredDisclosure(show: boolean): {
  readonly mounted: boolean;
  readonly open: boolean;
} {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (show) {
      setMounted(true);
    }
  }, [show]);
  useEffect(() => {
    if (!mounted) {
      return undefined;
    }
    if (!show) {
      setOpen(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted, show]);
  return { mounted, open };
}
