import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import Loading from '../components/Loading';
import { supabase } from '../lib/supabase';
import type { FieldToCollect } from '../types';

/** Free plan: keep in sync with FREE_MONTHLY_QUOTA in api/chat.ts. */
const FREE_MONTHLY_QUOTA = 10;

type ConvStatus = 'in_progress' | 'completed' | 'abandoned';

interface ConvRow {
  id: string;
  status: ConvStatus;
  summary: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
}

type ConvState =
  | { status: 'loading' }
  | { status: 'error'; detail: string }
  | { status: 'ready'; rows: ConvRow[]; monthCount: number };

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** "14:32" today, "Yesterday" or "12 Jul" otherwise. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Best display name for a conversation: a "name"-ish summary field, else the
 *  first non-empty value, else a status fallback. */
function convTitle(row: ConvRow): string {
  const s = row.summary;
  if (s) {
    const keys = Object.keys(s);
    const nameKey = keys.find((k) => /name|nom/i.test(k));
    const pick = (k: string | undefined) => {
      const v = k ? s[k] : undefined;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const byName = pick(nameKey);
    if (byName) return byName;
    for (const k of keys) {
      const v = pick(k);
      if (v) return v;
    }
  }
  return row.status === 'in_progress' ? 'Visitor (still answering)' : 'Visitor';
}

export default function Dashboard() {
  const { loading, session, profile, signOut } = useAuth();
  const [copied, setCopied] = useState(false);
  const [convs, setConvs] = useState<ConvState>({ status: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);

  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    (async () => {
      const [listRes, countRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, status, summary, started_at, completed_at')
          .order('started_at', { ascending: false })
          .limit(50),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .gte('started_at', startOfMonthISO()),
      ]);
      if (!active) return;
      if (listRes.error) {
        setConvs({ status: 'error', detail: listRes.error.message });
        return;
      }
      setConvs({
        status: 'ready',
        rows: (listRes.data ?? []) as ConvRow[],
        monthCount: countRes.count ?? 0,
      });
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;

  const publicLink = `${window.location.origin}/intake/${profile.slug}`;
  const fields = profile.intake_config?.fields_to_collect ?? [];
  const isPro = profile.plan === 'pro';

  async function copyLink() {
    await navigator.clipboard.writeText(publicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 space-y-8">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="rise flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{profile.business_name}</h1>
            <p className="text-sm text-ink-soft mt-0.5">{profile.profession}</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span
              className={
                'rounded-full px-3 py-1 text-xs font-semibold ' +
                (isPro ? 'bg-accent text-accent-deep' : 'bg-line/70 text-ink-soft')
              }
            >
              {isPro ? 'Pro' : 'Free'}
            </span>
            <button
              onClick={signOut}
              className="text-sm text-ink-faint hover:text-ink transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* ── Public link ────────────────────────────────────────── */}
        <section className="rise rise-1 card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Your intake link</h2>
            <a
              href={publicLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              Preview
            </a>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-paper border border-line px-3 py-2 font-mono text-xs text-ink-soft">
              {publicLink}
            </code>
            <button
              onClick={copyLink}
              className="rounded-[13px] bg-accent px-4 py-2 text-sm font-semibold text-ink transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(255,206,0,0.35)]"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Share it with clients — they chat, you get a structured summary below.
          </p>
        </section>

        {/* ── Conversations ──────────────────────────────────────── */}
        <section className="rise rise-2 space-y-3">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-sm font-semibold">Conversations</h2>
            {convs.status === 'ready' && (
              <span className="font-mono text-xs text-ink-faint">
                {isPro
                  ? `${convs.monthCount} this month`
                  : `${convs.monthCount} / ${FREE_MONTHLY_QUOTA} this month`}
              </span>
            )}
          </div>

          {/* Free-plan quota bar — the one place gold shows up on its own. */}
          {convs.status === 'ready' && !isPro && (
            <div className="h-1 rounded-full bg-line overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.min((convs.monthCount / FREE_MONTHLY_QUOTA) * 100, 100)}%`,
                }}
              />
            </div>
          )}

          {convs.status === 'loading' && (
            <div className="card p-8 text-center text-sm text-ink-faint">
              Loading conversations…
            </div>
          )}

          {convs.status === 'error' && (
            <div className="card p-5 text-sm text-ink-soft">
              Couldn’t load conversations.
              <span className="block mt-1 text-xs text-ink-faint">{convs.detail}</span>
            </div>
          )}

          {convs.status === 'ready' && convs.rows.length === 0 && (
            <div className="card p-10 text-center space-y-1.5">
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-sm text-ink-faint">
                Share your intake link — the first summaries will land here.
              </p>
            </div>
          )}

          {convs.status === 'ready' &&
            convs.rows.map((row) => (
              <ConversationCard
                key={row.id}
                row={row}
                fields={fields}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
              />
            ))}
        </section>

        <p className="text-center font-mono text-[11px] text-ink-faint pt-2">Powered by Claude ✦ Brevio</p>
      </div>
    </main>
  );
}

function ConversationCard({
  row,
  fields,
  open,
  onToggle,
}: {
  row: ConvRow;
  fields: FieldToCollect[];
  open: boolean;
  onToggle: () => void;
}) {
  const inProgress = row.status === 'in_progress';

  // Configured fields first (pro's own labels), then any extra summary keys.
  const summary = row.summary ?? {};
  const knownKeys = new Set(fields.map((f) => f.key));
  const extraKeys = Object.keys(summary).filter((k) => !knownKeys.has(k));

  const display = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  return (
    <article className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-paper/60 transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {inProgress && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="In progress" />
          )}
          <span className="truncate text-sm font-medium">{convTitle(row)}</span>
          {inProgress && <span className="text-xs text-ink-faint shrink-0">in progress</span>}
        </span>
        <span className="font-mono text-xs text-ink-faint shrink-0">
          {shortDate(row.started_at)}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4">
          {inProgress ? (
            <p className="text-sm text-ink-faint">
              The visitor hasn’t finished yet — the summary will appear once they’re done.
            </p>
          ) : (
            <dl className="space-y-2.5">
              {fields.map((f) => (
                <div key={f.key} className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-ink-faint">{f.label}</dt>
                  <dd className="text-ink whitespace-pre-wrap">
                    {display(summary[f.key]) ?? <span className="text-ink-faint">—</span>}
                  </dd>
                </div>
              ))}
              {extraKeys.map((k) => (
                <div key={k} className="flex gap-4 text-sm">
                  <dt className="w-32 shrink-0 text-ink-faint capitalize">
                    {k.replace(/_/g, ' ')}
                  </dt>
                  <dd className="text-ink whitespace-pre-wrap">
                    {display(summary[k]) ?? <span className="text-ink-faint">—</span>}
                  </dd>
                </div>
              ))}
              {fields.length === 0 && extraKeys.length === 0 && (
                <p className="text-sm text-ink-faint">No summary recorded.</p>
              )}
            </dl>
          )}
        </div>
      )}
    </article>
  );
}
