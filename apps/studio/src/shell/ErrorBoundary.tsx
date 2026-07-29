import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-level error boundary. Catches render/runtime errors anywhere in the tree and shows a
 * recoverable fallback instead of a blank white screen. Mounted at the root in main.tsx so a
 * crash in any route degrades gracefully with a reload path.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the visible fallback terse; put the component stack in the console for debugging.
    console.error('[studio] uncaught render error', error, info.componentStack);
  }

  /** Retry: clear the caught error so the subtree re-renders in place (no full page reload). */
  private resetErrorBoundary = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground"
      >
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Try again, or reload if it keeps happening. If the
            problem persists, contact your administrator.
          </p>
          {error.message ? (
            <p className="rounded-md border border-border bg-card px-3 py-2 text-left font-mono text-xs text-muted-foreground">
              {error.message}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={this.resetErrorBoundary}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
