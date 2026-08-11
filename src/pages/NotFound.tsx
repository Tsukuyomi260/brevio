import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-paper text-ink flex items-center justify-center p-6">
      <div className="rise w-full max-w-sm space-y-3 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Error 404
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          This page doesn't exist
        </h1>
        <p className="text-sm text-ink-soft">
          The link may be out of date, or the address slightly off.
        </p>
        <div className="pt-3">
          <Link to="/" className="btn-gold">
            Back to Brevio
          </Link>
        </div>
      </div>
    </main>
  );
}
