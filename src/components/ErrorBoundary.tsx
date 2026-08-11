import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './states';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a mistake in one component shows an
 * explanation instead of a blank white page.
 *
 * Must be a class: React exposes no hook equivalent for error boundaries.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ErrorScreen
        title="This page stopped working"
        description="The error has been logged. Reloading usually clears it."
        detail={error.message}
        onRetry={() => window.location.reload()}
        retryLabel="Reload the page"
      />
    );
  }
}
