import { Component, type ReactNode } from 'react';

/**
 * Last-resort boundary: a render crash anywhere in the app previously
 * unmounted the whole React tree and left a blank panel. Render a
 * readable failure notice instead and report the error through the boot
 * beacon channel installed by the webview HTML.
 */
export class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly message: string | null }
> {
  state: { readonly message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): {
    message: string;
  } {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown): void {
    const beacon = (
      globalThis as {
        __dvxBeacon?: (kind: string, detail: string) => void;
      }
    ).__dvxBeacon;
    beacon?.(
      'error',
      `render crash: ${
        error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      }`,
    );
  }

  render(): ReactNode {
    if (this.state.message === null) {
      return this.props.children;
    }
    return (
      <div className="dvx-fatal" role="alert">
        <h2 className="dvx-fatal-title">Something went wrong</h2>
        <p className="dvx-fatal-body">
          The chat view hit a rendering error. The details were written to the DroidVisX
          Logs output channel.
        </p>
        <pre className="dvx-fatal-detail">{this.state.message}</pre>
        <button
          type="button"
          className="dvx-fatal-reload"
          onClick={() => {
            this.setState({ message: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
