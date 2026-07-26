import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { AIInput } from '@/components/ui/ai-input';

interface PublicProfile {
  business_name: string;
  profession: string;
  assistant_name: string | null;
  welcome_message: string | null;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; detail: string }
  | { status: 'ready'; profile: PublicProfile };

export default function Intake() {
  const { slug } = useParams<{ slug: string }>();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    fetch(`/api/intake/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) return setLoad({ status: 'not_found' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const profile = (await res.json()) as PublicProfile;
        if (active) setLoad({ status: 'ready', profile });
      })
      .catch((err: unknown) => {
        if (active)
          setLoad({
            status: 'error',
            detail: err instanceof Error ? err.message : 'unknown error',
          });
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (load.status === 'loading') {
    return <Centered>Loading…</Centered>;
  }
  if (load.status === 'not_found') {
    return <Centered>This intake link doesn’t exist.</Centered>;
  }
  if (load.status === 'error') {
    return (
      <Centered>
        Couldn’t load this page.
        <span className="block text-xs text-ink-faint mt-1">{load.detail}</span>
      </Centered>
    );
  }

  const { profile } = load;
  const welcome =
    profile.welcome_message?.trim() ||
    `Hi! Before your appointment with ${profile.business_name}, I'd like to ask you a few quick questions.`;

  if (!started) {
    return (
      <main className="min-h-dvh bg-paper flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-ink">
              {profile.business_name}
            </h1>
            <p className="text-sm text-ink-soft">{profile.profession}</p>
          </div>
          <p className="text-ink-soft">{welcome}</p>
          <button
            onClick={() => setStarted(true)}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white"
          >
            Start
          </button>
          <p className="text-xs text-ink-faint">Powered by Brevio</p>
        </div>
      </main>
    );
  }

  return <Chat slug={slug!} profile={profile} welcome={welcome} />;
}

function Chat({
  slug,
  profile,
  welcome,
}: {
  slug: string;
  profile: PublicProfile;
  welcome: string;
}) {
  // `welcome` is display-only (first assistant bubble). The server owns the
  // real history; we keep a local copy just for rendering.
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  // Detect when the assistant has finished collecting (they say so explicitly).
  const isConvComplete = messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    /\b(voilà|toutes les informations|prêt|merci|done|fin|terminé|collected|finished)\b/i.test(
      messages[messages.length - 1]?.content || ''
    );

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || sending || blocked) return;

    setMessages((prev) => [...prev, { role: 'user', content: t }]);
    setError(null);
    setSending(true);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          conversation_id: conversationId,
          user_message: t,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setBlocked(data.message ?? 'This professional is not accepting new requests right now.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      setConversationId(data.conversation_id as string);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistant_message }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setSending(false);
      scrollToBottom();
    }
  }

  async function finish() {
    if (!conversationId || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEnded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setFinishing(false);
    }
  }

  if (ended) {
    return (
      <main className="min-h-dvh bg-paper flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3 text-center">
          <div className="animate-brevio-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-3xl text-ink">
            ✓
          </div>
          <h1 className="animate-brevio-rise font-display text-xl font-bold text-ink">
            Thank you!
          </h1>
          <p className="animate-brevio-rise-delay text-ink-soft">
            Your information has been sent. {profile.business_name} will get back
            to you soon.
          </p>
          <p className="animate-brevio-rise-delay font-mono text-[11px] text-ink-faint">
            Powered by Brevio
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col h-dvh bg-paper">
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <div>
          <h1 className="font-display text-sm font-semibold text-ink">{profile.business_name}</h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{profile.profession}</p>
        </div>
        {conversationId && !blocked && (
          <button
            onClick={finish}
            disabled={finishing}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {finishing ? 'Finishing…' : 'Finish'}
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <Bubble role="assistant" text={welcome} />
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {sending && <ThinkingBubble />}
        {error && <p className="text-sm text-amber-600">⚠ {error}</p>}
        {blocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {blocked}
          </div>
        )}
      </div>

      {!blocked && (
        <div className="border-t border-line bg-white space-y-3 px-4 py-3">
          {isConvComplete && (
            <div className="bg-accent text-ink px-4 py-3 rounded-[12px] text-center text-sm font-semibold">
              ✓ You're all set! Click <span className="font-mono">Finish</span> above to submit.
            </div>
          )}
          <AIInput
            placeholder="Type your answer…"
            onSubmit={sendText}
            disabled={sending || isConvComplete}
            minHeight={52}
            maxHeight={160}
          />
        </div>
      )}
    </main>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'text-right' : 'text-left'}>
      <span
        className={
          'inline-block rounded-2xl px-3.5 py-2 text-sm max-w-[85%] whitespace-pre-wrap ' +
          (isUser
            ? 'bg-ink text-white'
            : 'bg-white text-ink border border-line')
        }
      >
        {isUser ? text : <RevealText text={text} />}
      </span>
    </div>
  );
}

/** Reveals an assistant reply word-by-word — a "streaming" cascade.
 *  Whitespace (incl. newlines) is rendered as-is; only words animate. */
function RevealText({ text }: { text: string }) {
  const tokens = text.split(/(\s+)/);
  const wordCount = tokens.filter((t) => t && !/^\s+$/.test(t)).length;
  let wi = -1;
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok === '') return null;
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        wi += 1;
        return (
          <span
            key={i}
            className="brevio-word"
            style={{ animationDelay: `${(wi / Math.max(wordCount, 1)) * 0.9}s` }}
          >
            {tok}
          </span>
        );
      })}
    </>
  );
}

/** Animated "assistant is thinking" indicator. */
function ThinkingBubble() {
  return (
    <div className="text-left">
      <span className="brevio-thinking inline-flex items-center gap-1.5 rounded-2xl border bg-white px-4 py-3.5">
        <span className="brevio-dot" style={{ animationDelay: '0s' }} />
        <span className="brevio-dot" style={{ animationDelay: '0.18s' }} />
        <span className="brevio-dot" style={{ animationDelay: '0.36s' }} />
      </span>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-paper flex items-center justify-center p-6 text-center">
      <p className="text-ink-soft text-sm">{children}</p>
    </main>
  );
}
