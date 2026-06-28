import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import Loading from '../components/Loading';

export default function Dashboard() {
  const { loading, session, profile, signOut } = useAuth();
  const [copied, setCopied] = useState(false);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;

  const publicLink = `${window.location.origin}/intake/${profile.slug}`;

  async function copyLink() {
    await navigator.clipboard.writeText(publicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900 p-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{profile.business_name}</h1>
            <p className="text-sm text-slate-500">{profile.profession}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={
                'rounded-full px-3 py-1 text-xs font-medium ' +
                (profile.plan === 'pro'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-600')
              }
            >
              {profile.plan === 'pro' ? 'Pro' : 'Free'}
            </span>
            <button
              onClick={signOut}
              className="text-sm text-slate-500 hover:text-slate-800"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-medium text-slate-500">Your public intake link</h2>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {publicLink}
            </code>
            <button
              onClick={copyLink}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            The public intake page goes live in Step 4.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-slate-500 mb-2">Conversations</h2>
          <p className="text-sm text-slate-400">
            No conversations yet — they'll appear here once the intake page and
            summaries are wired up (Steps 4–6).
          </p>
        </section>
      </div>
    </main>
  );
}
