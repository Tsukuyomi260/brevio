import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react';

/**
 * The three screens every async surface needs: waiting, nothing yet, and
 * broken. Kept together so they stay visually consistent — an app that renders
 * its failures in a different language from its successes feels unfinished.
 */

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

/** Full-page wait. Use while auth or a route's primary data resolves. */
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-paper"
      role="status"
      aria-live="polite"
    >
      <Spinner className="w-6 h-6 text-ink-faint" />
      <p className="text-sm text-ink-faint">{label}</p>
    </main>
  );
}

/** Inline wait, for a panel refreshing inside an otherwise usable page. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="card flex items-center justify-center gap-2.5 p-8 text-sm text-ink-faint"
      role="status"
      aria-live="polite"
    >
      <Spinner className="w-4 h-4" />
      {label}
    </div>
  );
}

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** Nothing here yet — and, more usefully, what to do about it. */
export function EmptyState({ title, description, action }: StateProps) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-line/60 text-ink-faint">
        <Inbox className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-faint">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/**
 * Something failed. `detail` carries the technical text — shown small and
 * secondary, because it helps when reporting a problem but is never the point.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  detail,
  onRetry,
  retryLabel = 'Try again',
}: Omit<StateProps, 'title'> & {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center" role="alert">
      <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-faint">{description}</p>}
      {detail && (
        <p className="max-w-sm break-words font-mono text-[11px] text-ink-faint/80">{detail}</p>
      )}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-3 gap-2 text-xs">
          <RotateCw className="h-3.5 w-3.5" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Full-page failure, for when the whole route could not load. */
export function ErrorScreen(props: Parameters<typeof ErrorState>[0]) {
  return (
    <main className="min-h-dvh bg-paper p-6 flex items-center justify-center">
      <div className="w-full max-w-md">
        <ErrorState {...props} />
      </div>
    </main>
  );
}
