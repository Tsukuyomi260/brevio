import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Check, Download, ChevronDown, RotateCw, Repeat, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import CheckoutActivation from '../components/CheckoutActivation';
import { EmptyState, ErrorState, LoadingBlock, LoadingScreen } from '../components/states';
import { supabase } from '../lib/supabase';
import type { FieldToCollect } from '../types';

const FREE_MONTHLY_QUOTA = 10;

/** Conversations fetched for the list. Stat counts are queried separately. */
const LIST_LIMIT = 50;

type ConvStatus = 'in_progress' | 'completed' | 'abandoned';

interface ConvRow {
  id: string;
  status: ConvStatus;
  summary: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
}

interface MsgRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A client seen more than once, from the `contacts` table. */
interface ContactRow {
  id: string;
  full_name: string | null;
  visit_count: number;
  last_seen: string;
}

/** All-time counts — queried, not derived from the truncated list. */
interface Totals {
  completed: number;
  in_progress: number;
  abandoned: number;
}

type ConvState =
  | { status: 'loading' }
  | { status: 'error'; detail: string }
  | {
      status: 'ready';
      rows: ConvRow[];
      monthCount: number;
      totals: Totals;
      contacts: ContactRow[];
    };

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

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

function fullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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
  return 'Visitor';
}

export default function Dashboard() {
  const { loading, session, profile, signOut } = useAuth();
  const [convs, setConvs] = useState<ConvState>({ status: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Returning from Stripe Checkout. The plan itself is flipped by the webhook,
  // never by this redirect — a URL the user can type is not proof of payment.
  const checkout = searchParams.get('checkout');

  const clearCheckoutParam = () => {
    searchParams.delete('checkout');
    setSearchParams(searchParams, { replace: true });
  };

  // A cancelled checkout needs no screen of its own: nothing happened, and the
  // dashboard behind the toast is already the right place to be.
  useEffect(() => {
    if (checkout !== 'cancelled') return;
    toast('Checkout cancelled', { description: 'Nothing was charged.' });
    searchParams.delete('checkout');
    setSearchParams(searchParams, { replace: true });
  }, [checkout, searchParams, setSearchParams]);

  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    (async () => {
      const countByStatus = (s: ConvStatus) =>
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profileId)
          .eq('status', s);

      const [listRes, monthRes, doneRes, pendingRes, goneRes, contactsRes] =
        await Promise.all([
          supabase
            .from('conversations')
            .select('id, status, summary, started_at, completed_at')
            .eq('profile_id', profileId)
            .order('started_at', { ascending: false })
            .limit(LIST_LIMIT),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', profileId)
            .gte('started_at', startOfMonthISO()),
          countByStatus('completed'),
          countByStatus('in_progress'),
          countByStatus('abandoned'),
          // Returning clients. Tolerated as empty when migration 0002 has not
          // been applied yet — a missing table must not blank the dashboard.
          supabase
            .from('contacts')
            .select('id, full_name, visit_count, last_seen')
            .eq('profile_id', profileId)
            .gt('visit_count', 1)
            .order('last_seen', { ascending: false })
            .limit(10),
        ]);

      if (!active) return;
      setRefreshing(false);
      if (listRes.error) {
        setConvs({ status: 'error', detail: listRes.error.message });
        return;
      }
      setConvs({
        status: 'ready',
        rows: (listRes.data ?? []) as ConvRow[],
        monthCount: monthRes.count ?? 0,
        totals: {
          completed: doneRes.count ?? 0,
          in_progress: pendingRes.count ?? 0,
          abandoned: goneRes.count ?? 0,
        },
        contacts: contactsRes.error ? [] : ((contactsRes.data ?? []) as ContactRow[]),
      });
    })();
    return () => {
      active = false;
    };
  }, [profileId, refreshKey]);

  if (loading) return <LoadingScreen label="Opening your dashboard…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;

  // Owns the gap between paying and the webhook landing, so the pro never sees
  // a "Free" badge on a plan they have just bought.
  if (checkout === 'success') {
    return <CheckoutActivation onDone={clearCheckoutParam} />;
  }

  const publicLink = `${window.location.origin}/intake/${profile.slug}`;
  const fields = profile.intake_config?.fields_to_collect ?? [];
  const isPro = profile.plan === 'pro';

  const copyPublicLink = async () => {
    await navigator.clipboard.writeText(publicLink);
    setCopied('link');
    setTimeout(() => setCopied(null), 1500);
  };

  // All-time counts come from the count queries; the row list is capped at
  // LIST_LIMIT and would under-report once a pro passes 50 conversations.
  const completed = convs.status === 'ready' ? convs.totals.completed : 0;
  const abandoned = convs.status === 'ready' ? convs.totals.abandoned : 0;
  const inProgress = convs.status === 'ready' ? convs.totals.in_progress : 0;

  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  };

  const completedRows =
    convs.status === 'ready' ? convs.rows.filter((r) => r.status === 'completed').sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()) : [];

  const pendingRows =
    convs.status === 'ready'
      ? convs.rows
          .filter((r) => r.status === 'in_progress' || r.status === 'abandoned')
          .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      : [];

  return (
    <main className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 space-y-8">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="rise flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{profile.business_name}</h1>
            <p className="text-sm text-ink-soft mt-0.5">{profile.profession}</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={refresh}
              disabled={refreshing}
              title="Reload conversations"
              className="text-ink-faint hover:text-ink transition-colors disabled:opacity-40"
            >
              <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <span
              className={
                'rounded-full px-3 py-1 text-xs font-semibold ' +
                (isPro ? 'bg-accent text-accent-deep' : 'bg-line/70 text-ink-soft')
              }
            >
              {isPro ? 'Pro' : 'Free'}
            </span>
            <button onClick={signOut} className="text-sm text-ink-faint hover:text-ink transition-colors">
              Sign out
            </button>
          </div>
        </header>

        {/* ── Public link ────────────────────────────────────────── */}
        <section className="rise rise-1 card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Your intake link</h2>
            <a href={publicLink} target="_blank" rel="noreferrer" className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
              Preview
            </a>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-paper border border-line px-3 py-2 font-mono text-xs text-ink-soft">
              {publicLink}
            </code>
            <button onClick={copyPublicLink} className="btn-gold" title="Copy to clipboard">
              {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Share this link with clients. They'll chat with your assistant — you get a structured summary.
          </p>
        </section>

        {/* ── Stats ──────────────────────────────────────────────── */}
        {convs.status === 'ready' && (
          <section className="rise rise-2 grid grid-cols-3 gap-3">
            <StatCard label="Completed" value={completed} accent="gold" />
            <StatCard label="Pending" value={inProgress} accent="ink" />
            <StatCard label="Abandoned" value={abandoned} accent="faint" />
          </section>
        )}

        {/* ── Quota bar (Free plan only) ────────────────────────– */}
        {convs.status === 'ready' && !isPro && (
          <div className="rise rise-3 space-y-1">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-ink-soft">Monthly quota</p>
              <span className="font-mono text-xs text-ink-faint">
                {convs.monthCount} / {FREE_MONTHLY_QUOTA}
              </span>
            </div>
            <div className="h-2 rounded-full bg-line overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.min((convs.monthCount / FREE_MONTHLY_QUOTA) * 100, 100)}%`,
                }}
              />
            </div>
            <UpgradeButton
              accessToken={session.access_token}
              atQuota={convs.monthCount >= FREE_MONTHLY_QUOTA}
            />
          </div>
        )}

        {/* ── Returning clients ──────────────────────────────────– */}
        {convs.status === 'ready' && convs.contacts.length > 0 && (
          <section className="rise rise-3 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Repeat className="w-4 h-4 text-accent-deep" />
              Returning clients
            </h2>
            <div className="card divide-y divide-line">
              {convs.contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-5 py-3">
                  <span className="truncate text-sm font-medium">
                    {c.full_name?.trim() || 'Unnamed client'}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-faint">
                    {c.visit_count} visits · {shortDate(c.last_seen)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Completed summaries ────────────────────────────────– */}
        {convs.status === 'ready' && (
          <section className="rise rise-4 space-y-3">
            <h2 className="text-sm font-semibold">
              {completed === 0 ? 'No summaries yet' : `${completed} summar${completed === 1 ? 'y' : 'ies'} collected`}
            </h2>

            {completed === 0 && (
              <EmptyState
                title="Waiting for your first client"
                description="Share your intake link above. When a client finishes their chat, their summary appears here."
                action={
                  <button onClick={copyPublicLink} className="btn-ghost gap-2 text-xs">
                    <Copy className="h-3.5 w-3.5" />
                    {copied === 'link' ? 'Copied!' : 'Copy the link'}
                  </button>
                }
              />
            )}

            {completed > completedRows.length && (
              <p className="text-xs text-ink-faint">
                Showing the {completedRows.length} most recent of {completed}.
              </p>
            )}

            {completedRows.map((row, idx) => (
              <ConversationCard
                key={row.id}
                row={row}
                idx={idx + 1}
                fields={fields}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                onExportPDF={() => {
                  exportToPDF(convTitle(row), row.summary || {}, fields, profile.business_name);
                }}
              />
            ))}
          </section>
        )}

        {/* ── Pending / Abandoned ────────────────────────────────– */}
        {convs.status === 'ready' && pendingRows.length > 0 && (
          <section className="rise rise-5 space-y-3">
            <h2 className="text-sm font-semibold text-ink-faint">Pending & Abandoned</h2>
            {pendingRows.map((row) => (
              <div key={row.id} className="card p-4 text-sm text-ink-faint flex items-center justify-between">
                <span>
                  {convTitle(row)} · {shortDate(row.started_at)}
                  {row.status === 'in_progress' && ' · in progress'}
                  {row.status === 'abandoned' && ' · abandoned'}
                </span>
              </div>
            ))}
          </section>
        )}

        {convs.status === 'loading' && <LoadingBlock label="Loading conversations…" />}

        {convs.status === 'error' && (
          <ErrorState
            title="Couldn't load your conversations"
            description="Your summaries are safe — this is a problem reading them, not storing them."
            detail={convs.detail}
            onRetry={refresh}
          />
        )}

        <p className="text-center font-mono text-[11px] text-ink-faint">Powered by Claude ✦ Brevio</p>
      </div>
    </main>
  );
}

/**
 * Starts Checkout. The request carries only the caller's JWT — the price and
 * the account being upgraded are both resolved server-side in /api/checkout.
 */
function UpgradeButton({ accessToken, atQuota }: { accessToken: string; atQuota: boolean }) {
  const [busy, setBusy] = useState(false);

  async function upgrade() {
    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // A function that crashes before it can reply returns the platform's
      // plain-text error page. Parsing that as JSON throws a message about
      // stray characters, which hides what actually went wrong.
      const raw = await res.text();
      let data: { url?: string; error?: string } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          res.ok
            ? 'The server sent an unreadable response.'
            : `The server failed (HTTP ${res.status}). Check the function logs.`,
        );
      }

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.url) throw new Error('The server did not return a checkout link.');
      window.location.href = data.url;
    } catch (err) {
      setBusy(false);
      toast.error('Could not start the checkout', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  return (
    <div className="pt-2">
      <button onClick={upgrade} disabled={busy} className="btn-gold w-full gap-2">
        <Sparkles className="w-4 h-4" />
        {busy ? 'Opening checkout…' : 'Upgrade to Pro'}
      </button>
      {atQuota && (
        <p className="mt-2 text-xs text-ink-soft">
          You've used every free conversation this month — new visitors are being
          turned away until you upgrade.
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: 'gold' | 'ink' | 'faint' }) {
  const colorMap = {
    gold: 'bg-accent text-accent-deep',
    ink: 'bg-ink text-white',
    faint: 'bg-line/50 text-ink-faint',
  };
  return (
    <div className={`card p-4 text-center space-y-1 ${colorMap[accent]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

function ConversationCard({
  row,
  idx,
  fields,
  open,
  onToggle,
  onExportPDF,
}: {
  row: ConvRow;
  idx: number;
  fields: FieldToCollect[];
  open: boolean;
  onToggle: () => void;
  onExportPDF: () => void;
}) {
  const [transcript, setTranscript] = useState<MsgRow[] | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const summary = row.summary ?? {};
  const knownKeys = new Set(fields.map((f) => f.key));
  const extraKeys = Object.keys(summary).filter((k) => !knownKeys.has(k));
  const display = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Fetched on demand — most cards are never expanded. RLS policy
  // `messages_select_own` scopes this to the pro's own conversations.
  async function toggleTranscript() {
    if (transcript) {
      setShowTranscript((v) => !v);
      return;
    }
    setShowTranscript(true);
    const { data, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', row.id)
      .order('created_at', { ascending: true });

    if (error) {
      setTranscriptError(error.message);
      return;
    }
    setTranscriptError(null);
    setTranscript(((data ?? []) as MsgRow[]).filter((m) => m.role !== 'system'));
  }

  // Get preview of main info (name + reason)
  const name = fields.find((f) => /name|nom/i.test(f.key))?.key;
  const reason = fields.find((f) => /reason|motif/i.test(f.key))?.key;
  const nameVal = name ? display(summary[name]) : null;
  const reasonVal = reason ? display(summary[reason]) : null;

  return (
    <article className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left hover:bg-paper/60 transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-ink-faint font-semibold">#{idx}</span>
            <span className="text-sm font-bold text-ink truncate">{nameVal || 'Visitor'}</span>
          </div>
          {reasonVal && <p className="text-sm text-ink-soft line-clamp-2">{reasonVal}</p>}
          <p className="text-xs text-ink-faint">{fullDate(row.started_at)}</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-ink-faint shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4 space-y-4">
          {/* Full details */}
          <dl className="space-y-2.5">
            {fields.map((f) => (
              <div key={f.key} className="flex gap-4 text-sm">
                <dt className="w-32 shrink-0 font-medium text-ink-faint">{f.label}</dt>
                <dd className="text-ink whitespace-pre-wrap flex-1">{display(summary[f.key]) ?? <span className="text-ink-faint">—</span>}</dd>
              </div>
            ))}
            {extraKeys.map((k) => (
              <div key={k} className="flex gap-4 text-sm">
                <dt className="w-32 shrink-0 font-medium text-ink-faint capitalize">{k.replace(/_/g, ' ')}</dt>
                <dd className="text-ink whitespace-pre-wrap flex-1">{display(summary[k]) ?? <span className="text-ink-faint">—</span>}</dd>
              </div>
            ))}
            {fields.length === 0 && extraKeys.length === 0 && (
              <p className="text-sm text-ink-faint">No summary recorded.</p>
            )}
          </dl>

          {/* Actions */}
          <div className="flex items-center gap-5">
            <button
              onClick={onExportPDF}
              className="flex items-center gap-2 text-xs font-medium text-accent-deep hover:text-ink transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export as PDF
            </button>
            <button
              onClick={toggleTranscript}
              className="text-xs font-medium text-ink-faint hover:text-ink transition-colors"
            >
              {showTranscript ? 'Hide transcript' : 'View transcript'}
            </button>
          </div>

          {showTranscript && (
            <div className="space-y-2 border-t border-line pt-4">
              {transcriptError && (
                <p className="text-xs text-ink-soft">Couldn't load the transcript. {transcriptError}</p>
              )}
              {!transcriptError && transcript === null && (
                <p className="text-xs text-ink-faint">Loading…</p>
              )}
              {transcript?.length === 0 && (
                <p className="text-xs text-ink-faint">No messages recorded.</p>
              )}
              {transcript?.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                  <span
                    className={
                      'inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-xs ' +
                      (m.role === 'user' ? 'bg-ink text-white' : 'bg-paper border border-line text-ink-soft')
                    }
                  >
                    {m.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Escape a value for interpolation into the PDF markup.
 *
 * Summary values are visitor-authored text passed through the model, and
 * html2pdf renders this HTML in the document to rasterise it. Without escaping,
 * an answer such as `<img src=x onerror=…>` would execute in the pro's
 * authenticated session the moment they export.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip characters that are illegal or awkward in a download filename. */
function safeFilePart(value: string): string {
  return value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'client';
}

/**
 * html2pdf pulls in jsPDF and html2canvas — together the bulk of the bundle,
 * for a button most sessions never press. Loaded on demand instead.
 */
async function exportToPDF(
  clientName: string,
  summary: Record<string, unknown>,
  fields: FieldToCollect[],
  businessName: string
) {
  const { default: html2pdf } = await import('html2pdf.js');

  const knownKeys = new Set(fields.map((f) => f.key));
  const extraKeys = Object.keys(summary).filter((k) => !knownKeys.has(k));
  const display = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const block = (label: string, value: string | null) => `
        <div style="margin-bottom: 18px;">
          <p style="font-size: 12px; font-weight: 600; color: #4a5565; text-transform: uppercase; margin-bottom: 6px;">${escapeHtml(label)}</p>
          <p style="font-size: 14px; color: #1b1b18; line-height: 1.5;">${value ? escapeHtml(value) : '—'}</p>
        </div>
      `;

  const html = `
    <div style="font-family: system-ui, sans-serif; padding: 40px; color: #1b1b18;">
      <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(businessName)}</h1>
      <p style="font-size: 14px; color: #4a5565; margin-bottom: 32px;">Client Intake Summary</p>

      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1b1b18;">${escapeHtml(clientName)}</h2>
      <p style="font-size: 12px; color: #9ba1a5; margin-bottom: 24px;">${new Date().toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}</p>

      <hr style="border: none; border-top: 1px solid #e9e7e2; margin-bottom: 24px;" />

      ${fields.map((f) => block(f.label, display(summary[f.key]))).join('')}
      ${extraKeys.map((k) => block(k.replace(/_/g, ' '), display(summary[k]))).join('')}

      <hr style="border: none; border-top: 1px solid #e9e7e2; margin-top: 32px; margin-bottom: 16px;" />
      <p style="font-size: 11px; color: #9ba1a5; text-align: center;">Generated by Brevio • ${new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })}</p>
    </div>
  `;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt: any = {
    margin: 0,
    filename: `${safeFilePart(clientName)}-${safeFilePart(businessName)}-${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  html2pdf().set(opt).from(html).save();
}
