import { useState, type CSSProperties, type ReactNode } from 'react';
import { UiEnvironmentProvider, type UiEnvironment } from './environment';
import { PortalContainerProvider, TooltipProvider } from './ui/overlays';

export function UiRoot({ children, theme = 'light', environment, className, style }: {
  readonly children: ReactNode;
  readonly theme?: 'light' | 'dark';
  readonly environment?: UiEnvironment;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const content = environment ? <UiEnvironmentProvider value={environment}>{children}</UiEnvironmentProvider> : children;
  return <div ref={setContainer} data-theme={theme} className={`agent-chat-ui ${className ?? ''}`} style={style}>
    {container ? <PortalContainerProvider container={container}><TooltipProvider delayDuration={400}>{content}</TooltipProvider></PortalContainerProvider> : null}
  </div>;
}
