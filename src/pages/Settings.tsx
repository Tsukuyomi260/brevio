import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { LoadingScreen, Spinner } from '../components/states';
import type { FieldToCollect, IntakeConfig } from '../types';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * Turn a label into a stable key for the summary JSON. Generated once when a
 * field is added and never regenerated: the key is what past summaries are
 * stored under, so renaming a label must not orphan the data behind it.
 */
function toKey(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  );
}

export default function Settings() {
  const { loading, session, profile, refreshProfile } = useAuth();

  const [businessName, setBusinessName] = useState('');
  const [profession, setProfession] = useState('');
  const [assistantName, setAssistantName] = useState('');
  const [welcome, setWelcome] = useState('');
  const [instructions, setInstructions] = useState('');
  const [fields, setFields] = useState<FieldToCollect[]>([]);
  const [newField, setNewField] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (loading) return <LoadingScreen label="Loading your settings…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;

  // Seed the form from the profile once, then let the user own the values.
  if (!hydrated) {
    const cfg = profile.intake_config ?? {};
    setBusinessName(profile.business_name);
    setProfession(profile.profession);
    setAssistantName(cfg.assistant_name ?? '');
    setWelcome(cfg.welcome_message ?? '');
    setInstructions(cfg.system_prompt_addition ?? '');
    setFields(cfg.fields_to_collect ?? []);
    setHydrated(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);

    const intake_config: IntakeConfig = {
      assistant_name: assistantName.trim() || undefined,
      welcome_message: welcome.trim() || undefined,
      system_prompt_addition: instructions.trim() || undefined,
      fields_to_collect: fields,
    };

    const { error } = await supabase
      .from('profiles')
      .update({
        business_name: businessName.trim(),
        profession: profession.trim(),
        intake_config,
      })
      .eq('id', profile.id);

    setSaving(false);
    if (error) {
      toast.error('Could not save', { description: error.message });
      return;
    }
    await refreshProfile();
    toast.success('Settings saved', {
      description: 'Your assistant uses them from the next conversation.',
    });
  }

  async function onLogoPick(file: File | undefined) {
    if (!file || !profile) return;

    if (!LOGO_TYPES.includes(file.type)) {
      toast.error('Unsupported image', { description: 'Use a PNG, JPEG, WebP or SVG.' });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Image too large', { description: 'Keep it under 2 MB.' });
      return;
    }

    setUploading(true);
    // Keyed under the profile id — the storage policy checks that first path
    // segment, so a pro can only ever write into their own folder.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${profile.id}/logo-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      setUploading(false);
      toast.error('Upload failed', { description: upErr.message });
      return;
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(path);
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ logo_url: data.publicUrl })
      .eq('id', profile.id);

    setUploading(false);
    if (dbErr) {
      toast.error('Could not save the logo', { description: dbErr.message });
      return;
    }
    await refreshProfile();
    toast.success('Logo updated');
  }

  async function removeLogo() {
    if (!profile) return;
    const { error } = await supabase
      .from('profiles')
      .update({ logo_url: null })
      .eq('id', profile.id);
    if (error) {
      toast.error('Could not remove the logo', { description: error.message });
      return;
    }
    await refreshProfile();
  }

  function addField() {
    const label = newField.trim();
    if (!label) return;
    const key = toKey(label);
    if (fields.some((f) => f.key === key)) {
      toast('Already collected', { description: `"${label}" is in the list.` });
      return;
    }
    setFields([...fields, { key, label, required: true }]);
    setNewField('');
  }

  return (
    <main className="min-h-dvh bg-paper text-ink">
      <form onSubmit={onSave} className="mx-auto w-full max-w-2xl px-5 py-8 space-y-8">
        <header className="rise space-y-1">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-faint transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3 w-3" />
            Dashboard
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-ink-soft">
            How your assistant introduces itself, and what it collects.
          </p>
        </header>

        {/* ── Practice ─────────────────────────────────────────────── */}
        <Section title="Practice" hint="Shown to visitors at the top of your intake page.">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-line bg-white">
              {profile.logo_url ? (
                <img src={profile.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-xl font-bold text-ink-faint">
                  {businessName.trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="btn-ghost cursor-pointer gap-2 py-2 text-xs">
                  {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                  {uploading ? 'Uploading…' : 'Upload a logo'}
                  <input
                    type="file"
                    accept={LOGO_TYPES.join(',')}
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => onLogoPick(e.target.files?.[0])}
                  />
                </label>
                {profile.logo_url && (
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="text-xs text-ink-faint transition-colors hover:text-ink"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-ink-faint">PNG, JPEG, WebP or SVG — up to 2 MB.</p>
            </div>
          </div>

          <Field label="Business name">
            <input
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Profession">
            <input
              required
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
              className="input"
            />
          </Field>
          <p className="text-xs text-ink-faint">
            Your public link stays <span className="font-mono">/intake/{profile.slug}</span> even if
            the name changes, so shared links keep working.
          </p>
        </Section>

        {/* ── Assistant ────────────────────────────────────────────── */}
        <Section title="Assistant" hint="Its name, its opening line, and how it should behave.">
          <Field label="Assistant name">
            <input
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              placeholder="Alex"
              className="input"
            />
          </Field>
          <Field label="Welcome message">
            <textarea
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              rows={2}
              placeholder="Bonjour ! Avant votre rendez-vous, j'ai quelques questions rapides."
              className="input"
            />
          </Field>
          <Field label="Instructions">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              placeholder="Ask about symptoms and how long they have lasted. Never give medical advice. If the visitor sounds distressed, tell them to call the practice directly."
              className="input"
            />
          </Field>
          <p className="text-xs text-ink-faint">
            These go into the assistant's system prompt. Be specific about what matters to you —
            tone, what to dig into, what to avoid.
          </p>
        </Section>

        {/* ── Fields ───────────────────────────────────────────────── */}
        <Section
          title="Information collected"
          hint="Each entry becomes a line in the summary you receive."
        >
          {fields.length === 0 && (
            <p className="text-sm text-ink-faint">
              Nothing listed yet — the assistant will collect whatever the conversation surfaces.
            </p>
          )}

          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li key={f.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <span className="flex-1 truncate text-sm">{f.label}</span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-faint">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => {
                      const next = [...fields];
                      next[i] = { ...f, required: e.target.checked };
                      setFields(next);
                    }}
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => setFields(fields.filter((x) => x.key !== f.key))}
                  className="shrink-0 text-ink-faint transition-colors hover:text-red-600"
                  aria-label={`Remove ${f.label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <input
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addField();
                }
              }}
              placeholder="Add something to collect — e.g. Insurance provider"
              className="input flex-1"
            />
            <button type="button" onClick={addField} className="btn-ghost shrink-0 gap-1.5 py-2 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Removing an entry stops future collection. Summaries already recorded keep everything
            they captured.
          </p>
        </Section>

        <div className="sticky bottom-4 pt-2">
          <button type="submit" disabled={saving} className="btn-gold w-full">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rise card space-y-4 p-5">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
