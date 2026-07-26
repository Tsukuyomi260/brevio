import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import Loading from '../components/Loading';

export default function Login() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading) return <Loading />;
  if (session) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate('/dashboard');
  }

  return (
    <main className="min-h-dvh bg-paper text-ink flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="rise card w-full max-w-sm p-7 space-y-4">
        <div className="space-y-1 pb-1">
          <Link to="/" className="font-mono text-[11px] text-ink-faint hover:text-ink transition-colors">
            ← Brevio
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
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
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className="btn-gold w-full">
          {loading ? 'Logging in…' : 'Log in'}
        </button>

        <p className="text-sm text-ink-soft text-center">
          No account?{' '}
          <Link to="/signup" className="text-ink font-medium underline underline-offset-2">
            Sign up
          </Link>
        </p>
      </form>
    </main>
  );
}
