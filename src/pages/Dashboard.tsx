import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Copy, Check, Download, ChevronDown } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { useAuth } from '../auth/AuthProvider';
import Loading from '../components/Loading';
import { supabase } from '../lib/supabase';
import type { FieldToCollect } from '../types';

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

  const copyPublicLink = async () => {
    await navigator.clipboard.writeText(publicLink);
    setCopied('link');
    setTimeout(() => setCopied(null), 1500);
  };

  const completed = convs.status === 'ready' ? convs.rows.filter((r) => r.status === 'completed').length : 0;
  const abandoned = convs.status === 'ready' ? convs.rows.filter((r) => r.status === 'abandoned').length : 0;
  const inProgress = convs.status === 'ready' ? convs.rows.filter((r) => r.status === 'in_progress').length : 0;

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
          </div>
        )}

        {/* ── Completed summaries ────────────────────────────────– */}
        {convs.status === 'ready' && (
          <section className="rise rise-4 space-y-3">
            <h2 className="text-sm font-semibold">
              {completed === 0 ? 'No summaries yet' : `${completed} summar${completed === 1 ? 'y' : 'ies'} collected`}
            </h2>

            {completed === 0 && (
              <div className="card p-10 text-center space-y-2">
                <p className="text-sm font-medium">Waiting for your first client…</p>
                <p className="text-sm text-ink-faint">
                  Share your intake link above. When clients finish, their summaries will appear here.
                </p>
              </div>
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

        {convs.status === 'loading' && (
          <div className="card p-8 text-center text-sm text-ink-faint">
            Loading conversations…
          </div>
        )}

        {convs.status === 'error' && (
          <div className="card p-5 text-sm text-ink-soft">
            Couldn't load conversations.
            <span className="block mt-1 text-xs text-ink-faint">{convs.detail}</span>
          </div>
        )}

        <p className="text-center font-mono text-[11px] text-ink-faint">Powered by Claude ✦ Brevio</p>
      </div>
    </main>
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
  const summary = row.summary ?? {};
  const knownKeys = new Set(fields.map((f) => f.key));
  const extraKeys = Object.keys(summary).filter((k) => !knownKeys.has(k));
  const display = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

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
          <button
            onClick={onExportPDF}
            className="flex items-center gap-2 text-xs font-medium text-accent hover:text-accent-deep transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export as PDF
          </button>
        </div>
      )}
    </article>
  );
}

function exportToPDF(
  clientName: string,
  summary: Record<string, unknown>,
  fields: FieldToCollect[],
  businessName: string
) {
  const knownKeys = new Set(fields.map((f) => f.key));
  const extraKeys = Object.keys(summary).filter((k) => !knownKeys.has(k));
  const display = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Build HTML for PDF
  const html = `
    <div style="font-family: system-ui, sans-serif; padding: 40px; color: #1b1b18;">
      <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 8px;">${businessName}</h1>
      <p style="font-size: 14px; color: #4a5565; margin-bottom: 32px;">Client Intake Summary</p>

      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 16px; color: #1b1b18;">${clientName}</h2>
      <p style="font-size: 12px; color: #9ba1a5; margin-bottom: 24px;">${new Date().toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}</p>

      <hr style="border: none; border-top: 1px solid #e9e7e2; margin-bottom: 24px;" />

      ${fields
        .map((f) => {
          const v = display(summary[f.key]);
          return `
        <div style="margin-bottom: 18px;">
          <p style="font-size: 12px; font-weight: 600; color: #4a5565; text-transform: uppercase; margin-bottom: 6px;">${f.label}</p>
          <p style="font-size: 14px; color: #1b1b18; line-height: 1.5;">${v || '—'}</p>
        </div>
      `;
        })
        .join('')}

      ${extraKeys
        .map((k) => {
          const v = display(summary[k]);
          return `
        <div style="margin-bottom: 18px;">
          <p style="font-size: 12px; font-weight: 600; color: #4a5565; text-transform: uppercase; margin-bottom: 6px;">${k.replace(/_/g, ' ')}</p>
          <p style="font-size: 14px; color: #1b1b18; line-height: 1.5;">${v || '—'}</p>
        </div>
      `;
        })
        .join('')}

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
    filename: `${clientName}-${businessName}-${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  html2pdf().set(opt).from(html).save();
}
