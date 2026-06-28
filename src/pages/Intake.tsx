import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

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
        <span className="block text-xs text-slate-400 mt-1">{load.detail}</span>
      </Centered>
    );
  }

  const { profile } = load;
  const welcome =
    profile.welcome_message?.trim() ||
    `Hi! Before your appointment with ${profile.business_name}, I'd like to ask you a few quick questions.`;

  if (!started) {
    return (
      <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">
              {profile.business_name}
            </h1>
            <p className="text-sm text-slate-500">{profile.profession}</p>
          </div>
          <p className="text-slate-700">{welcome}</p>
          <button
            onClick={() => setStarted(true)}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white"
          >
            Start
          </button>
          <p className="text-xs text-slate-400">Powered by Brevio</p>
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
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || blocked) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
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
          user_message: text,
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

  return (
    <main className="flex flex-col h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-900">{profile.business_name}</h1>
        <p className="text-xs text-slate-400">{profile.profession}</p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <Bubble role="assistant">{welcome}</Bubble>
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content}
          </Bubble>
        ))}
        {sending && <p className="text-sm text-slate-400">Typing…</p>}
        {error && <p className="text-sm text-amber-600">⚠ {error}</p>}
        {blocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {blocked}
          </div>
        )}
      </div>

      {!blocked && (
        <form
          onSubmit={send}
          className="flex gap-2 border-t border-slate-200 bg-white p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
    </main>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: ReactNode }) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'text-right' : 'text-left'}>
      <span
        className={
          'inline-block rounded-2xl px-3.5 py-2 text-sm max-w-[85%] whitespace-pre-wrap ' +
          (isUser
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-800 border border-slate-200')
        }
      >
        {children}
      </span>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-6 text-center">
      <p className="text-slate-600 text-sm">{children}</p>
    </main>
  );
}
