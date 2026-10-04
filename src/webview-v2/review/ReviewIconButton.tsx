import type { ComponentProps } from 'react';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlays';

/** Shared tooltip retains Radix trigger props for menus and toggles. */
export function ReviewIconButton(props: ComponentProps<typeof Button> & { 'aria-label': string }) {
  return <Tooltip content={props['aria-label']}><Button {...props} /></Tooltip>;
}
