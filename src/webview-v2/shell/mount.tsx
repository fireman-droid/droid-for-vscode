import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { copyText } from '../bridge/clipboard';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../ui/button';
import { PortalContainerProvider, TooltipProvider } from '../ui/overlays';
import { applyBootTheme } from './theme';
import { createSyntaxWorker } from './syntaxWorker';

class RenderBoundary extends Component<
  { readonly children: ReactNode; readonly report: (message: string) => void },
  { readonly failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.report(`${error.name}: ${error.message}\n${info.componentStack ?? ''}`.slice(0, 2048));
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="space-y-3 p-4">
        <h1 className="font-medium">The view could not render</h1>
        <p className="text-muted-foreground">Your saved data remains on the host.</p>
        <Button variant="outline" onClick={() => this.setState({ failed: false })}>Try again</Button>
      </main>
    );
  }
}

export function mountWebview(children: ReactNode, report: (message: string) => void): void {
  const element = document.getElementById('root');
  if (element === null) throw new Error('Droid root element is missing.');
  // Radix's style singleton reads this hook before injecting dialog scroll-lock CSS.
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  if (nonce) (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;
  applyBootTheme();
  element.replaceChildren();
  element.removeAttribute('style');
  (globalThis as { __dvxBooted?: boolean }).__dvxBooted = true;
  createRoot(element).render(
    <RenderBoundary report={report}>
      <PortalContainerProvider container={element}>
        <UiEnvironmentProvider value={{ assistantName: 'Droid', copyText, createSyntaxWorker }}><TooltipProvider delayDuration={400}>{children}</TooltipProvider></UiEnvironmentProvider>
      </PortalContainerProvider>
    </RenderBoundary>,
  );
}
