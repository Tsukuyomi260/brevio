import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export default function Landing() {
  const { session } = useAuth();

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Brevio</h1>
          <p className="text-slate-600">
            Let an AI assistant collect what you need from clients before the
            appointment — through a natural conversation, not a form.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {session ? (
            <Link
              to="/dashboard"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/signup"
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
              >
                Get started — it's free
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
