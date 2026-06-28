import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-6 text-center">
      <div className="space-y-3">
        <p className="text-slate-600">Page not found.</p>
        <Link to="/" className="text-sm text-slate-900 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
