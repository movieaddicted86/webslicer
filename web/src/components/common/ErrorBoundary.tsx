import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

/** What the app does with a caught error: log it and tell the user (the toast path). */
export type ErrorReporter = (error: unknown, info?: ErrorInfo) => void;

interface ErrorBoundaryProps {
  /** the region's name for the log line and the card ("Viewer", "Preview", "Dialogs") */
  region: string;
  onError?: ErrorReporter;
  /**
   * Where the card sits when the region fails: `inline` (default) keeps the region's own place in the
   * flow, `scene` fills the scene and centres it, `overlay` floats over the app like a dialog.
   */
  placement?: 'inline' | 'scene' | 'overlay';
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
  /** bumped by "Reload view", so the children are rebuilt from scratch */
  generation: number;
}

/**
 * The recovery card of one region (P-7): the viewer, the preview panel and the dialog host each sit in
 * their own boundary, so a throw inside the WebGL setup, the toolpath loader or a dialog shows a small
 * "Something went wrong – Reload view" card **in that region** instead of unmounting the whole app.
 * Everything else keeps working, and the button remounts the region.
 *
 * A class component on purpose: `getDerivedStateFromError`/`componentDidCatch` only exist there.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { generation: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private retry = (): void => {
    this.setState((s) => ({ error: undefined, generation: s.generation + 1 }));
  };

  render(): ReactNode {
    const { error, generation } = this.state;
    if (error) {
      const placement = this.props.placement ?? 'inline';
      return (
        <div className={`error-fallback ${placement}`} role="alert" data-testid="error-fallback">
          <strong>Something went wrong – Reload view</strong>
          <span className="muted small">
            {this.props.region}: {error.message || 'unexpected error'}
          </span>
          <button className="secondary" data-testid="error-retry" onClick={this.retry}>
            Reload view
          </button>
        </div>
      );
    }
    // `display: contents` keeps the region's layout exactly as it was without the boundary
    return (
      <div className="error-region" key={generation}>
        {this.props.children}
      </div>
    );
  }
}
