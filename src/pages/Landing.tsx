import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { FREE_MONTHLY_QUOTA } from '../types';

const STEPS = [
  {
    n: '01',
    title: 'Configure your assistant',
    body: 'Name it, tell it what to collect — takes two minutes.',
  },
  {
    n: '02',
    title: 'Share one link',
    body: 'Clients chat before the appointment. No forms, no signup.',
  },
  {
    n: '03',
    title: 'Read the summary',
    body: 'Every conversation lands as a clean, structured brief.',
  },
];

export default function Landing() {
  const { session } = useAuth();

  return (
    <main className="min-h-dvh bg-paper text-ink flex flex-col">
      <header className="rise flex items-center justify-between px-6 py-5 max-w-4xl mx-auto w-full">
        <span className="font-display text-xl font-bold tracking-tight">Brevio</span>
        {!session && (
          <Link to="/login" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">
            Log in
          </Link>
        )}
      </header>

      <section className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl text-center space-y-8">
          <p className="rise rise-1 mono-label">✦ AI intake assistant</p>

          <h1 className="rise rise-2 font-display text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
            Know your clients <span className="hl">before</span> they walk&nbsp;in.
          </h1>

          <p className="rise rise-3 text-lg text-ink-soft max-w-xl mx-auto">
            An AI assistant collects what you need from clients ahead of the
            appointment — through a natural conversation, not a form.
          </p>

          <div className="rise rise-4 flex flex-col sm:flex-row gap-3 justify-center">
            {session ? (
              <Link to="/dashboard" className="btn-gold">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/signup" className="btn-gold">
                  Get started — it's free
                </Link>
                <Link to="/login" className="btn-ghost">
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rise rise-5 px-6 pb-12 max-w-4xl mx-auto w-full">
        <div className="grid sm:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-5 text-left space-y-2">
              <span className="font-mono text-sm text-accent-deep">{s.n}</span>
              <h2 className="font-display font-semibold">{s.title}</h2>
              <p className="text-sm text-ink-soft leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing belongs in public: asking someone to sign up to discover what
          a subscription costs is a good way to lose them at the door. */}
      <section className="px-6 pb-14 max-w-4xl mx-auto w-full">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display font-semibold">Free</h2>
              <span className="font-mono text-sm text-ink-soft">€0</span>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              {FREE_MONTHLY_QUOTA} conversations a month, every feature included.
              Enough to see whether it earns its place.
            </p>
          </div>

          <div className="rounded-[14px] border border-accent/50 bg-accent/10 p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display font-semibold">Pro</h2>
              <span className="font-mono text-sm text-ink">
                €11.99<span className="text-ink-soft">/month</span>
              </span>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              Unlimited conversations. Cancel whenever you like — it stays active
              until the end of the period you paid for.
            </p>
          </div>
        </div>

        <p className="text-center font-mono text-[11px] text-ink-faint mt-10">
          Powered by Claude ✦ Brevio
        </p>
      </section>
    </main>
  );
}
