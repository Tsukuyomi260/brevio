import { useEffect, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Spinner } from './states';

/** How long to wait for the webhook before offering reassurance instead. */
const TIMEOUT_MS = 45000;
const POLL_MS = 2000;

/**
 * Shown when the visitor returns from Stripe Checkout having paid.
 *
 * The plan does not flip on this redirect — it flips when Stripe's webhook
 * reaches the server, which can be a few seconds later. Dropping the pro
 * straight onto a dashboard still labelled "Free" reads as a failed payment, so
 * this screen owns the wait and polls until the change lands.
 *
 * Payment is never in doubt here: Stripe took it before redirecting. Only the
 * activation is pending, and the copy says so even when it runs long.
 */
export default function CheckoutActivation({ onDone }: { onDone: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [tookTooLong, setTookTooLong] = useState(false);
  const startedAt = useRef(Date.now());

  const active = profile?.plan === 'pro';

  useEffect(() => {
    if (active) return;

    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > TIMEOUT_MS) {
        setTookTooLong(true);
        clearInterval(timer);
        return;
      }
      void refreshProfile();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [active, refreshProfile]);

  return (
    <main className="min-h-dvh bg-paper text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-4">
        {active ? (
          <>
            <div className="animate-brevio-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-ink">
              <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
            </div>
            <h1 className="animate-brevio-rise font-display text-2xl font-bold tracking-tight">
              You're on Pro
            </h1>
            <p className="animate-brevio-rise-delay text-ink-soft">
              The monthly limit is lifted — your assistant will keep taking new
              clients for as long as your subscription runs.
            </p>
            <div className="animate-brevio-rise-delay pt-2">
              <button onClick={onDone} className="btn-gold w-full gap-2">
                <Sparkles className="h-4 w-4" />
                Back to the dashboard
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-line/60">
              <Spinner className="h-6 w-6 text-ink-soft" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Payment received
            </h1>

            {tookTooLong ? (
              <>
                <p className="text-ink-soft">
                  Activation is taking longer than usual. Your payment went
                  through and nothing is lost — the Pro plan will switch on by
                  itself, usually within a few minutes.
                </p>
                <div className="pt-2">
                  <button onClick={onDone} className="btn-ghost w-full">
                    Continue to the dashboard
                  </button>
                </div>
              </>
            ) : (
              <p className="text-ink-soft" role="status" aria-live="polite">
                Activating your Pro plan. This takes a few seconds — you can stay
                on this page.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
