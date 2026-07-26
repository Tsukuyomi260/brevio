import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import Loading from '../components/Loading';

export default function Signup() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading) return <Loading />;
  if (session) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data.session) {
      // Email confirmation disabled — straight into onboarding.
      navigate('/onboarding');
    } else {
      // Email confirmation enabled — user must confirm before logging in.
      setInfo('Check your email to confirm your account, then log in.');
    }
  }

  return (
    <main className="min-h-dvh bg-paper text-ink flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="rise card w-full max-w-sm p-7 space-y-4">
        <div className="space-y-1 pb-1">
          <Link to="/" className="font-mono text-[11px] text-ink-faint hover:text-ink transition-colors">
            ← Brevio
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Create your account
          </h1>
        </div>

        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-accent-deep">{info}</p>}

        <button type="submit" disabled={loading} className="btn-gold w-full">
          {loading ? 'Creating…' : 'Sign up'}
        </button>

        <p className="text-sm text-ink-soft text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-ink font-medium underline underline-offset-2">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
