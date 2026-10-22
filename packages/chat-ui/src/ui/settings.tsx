import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';

export function SettingsSection({ title, children, className, ...props }: Omit<ComponentProps<'section'>, 'title'> & {
  readonly title?: ReactNode;
}) {
  const headingId = useId();
  return <section aria-labelledby={title ? headingId : undefined} className={cn('dvx-settings-section', className)} {...props}>
    {title && <h2 id={headingId} className="dvx-settings-title">{title}</h2>}
    <div className="dvx-settings-group">{children}</div>
  </section>;
}

export function SettingsRow({ label, detail, children, className, controlClassName, ...props }: ComponentProps<'div'> & {
  readonly label: ReactNode;
  readonly detail?: ReactNode;
  readonly controlClassName?: string;
}) {
  return <div className={cn('dvx-settings-row', className)} {...props}>
    <div className="dvx-settings-label" data-ui-notice="">{label}{detail && <small className="dvx-settings-detail">{detail}</small>}</div>
    <div className={cn('dvx-settings-control', controlClassName)}>{children}</div>
  </div>;
}
