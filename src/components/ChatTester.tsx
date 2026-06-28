import { useRef, useState, type FormEvent } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Demo context so the assistant has some flavor while we test Step 2.
// Replaced by real per-pro config (from DB) in Step 5.
const DEMO_CONTEXT = {
  businessName: 'Cabinet Dupont',
  profession: 'Dentist',
  instructions:
    'Collect: reason for the visit, symptoms, level of urgency, and relevant medical history.',
};

export default function ChatTester() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, ...DEMO_CONTEXT }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessages([...next, { role: 'assistant', content: data.assistant_message }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden text-left">
      <div className="border-b border-slate-100 px-4 py-2">
        <p className="text-sm font-medium text-slate-500">Chat tester · /api/chat</p>
        <p className="text-xs text-slate-400">Demo context: {DEMO_CONTEXT.businessName}</p>
      </div>

      <div ref={scrollRef} className="h-72 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">Send a message to start the conversation…</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={
                'inline-block rounded-2xl px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap ' +
                (m.role === 'user'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800')
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {loading && <p className="text-sm text-slate-400">Assistant is typing…</p>}
        {error && <p className="text-sm text-amber-600">⚠ {error}</p>}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
