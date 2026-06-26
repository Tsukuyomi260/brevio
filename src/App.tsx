import { useEffect, useState } from 'react';

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; message: string; time: string }
  | { status: 'error'; detail: string };

function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    fetch('/api/hello')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { message: string; time: string };
        setHealth({ status: 'ok', message: data.message, time: data.time });
      })
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : 'unknown error';
        setHealth({ status: 'error', detail });
      });
  }, []);

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">AI Intake Assistant</h1>
          <p className="text-slate-600">
            Conversational intake for service professionals. Powered by OpenAI,
            billed with Stripe.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500 mb-2">API health</p>
          {health.status === 'loading' && (
            <p className="text-slate-400">Checking…</p>
          )}
          {health.status === 'ok' && (
            <div className="space-y-1">
              <p className="font-semibold text-emerald-600">● {health.message}</p>
              <p className="text-xs text-slate-400">{health.time}</p>
            </div>
          )}
          {health.status === 'error' && (
            <div className="space-y-1">
              <p className="font-semibold text-amber-600">● API unreachable</p>
              <p className="text-xs text-slate-400">
                {health.detail} — run <code>vercel dev</code> to enable /api.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">Step 1 · scaffold + hello-world</p>
      </div>
    </main>
  );
}

export default App;
