"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  model?: string | null;
}

const SUGGESTIONS = [
  "Am I on pace for my goals this week?",
  "What KPI is hurting me the most?",
  "How many Internets do I need today?",
  "What should I focus on this shift?",
  "How did I do last week?",
];

/**
 * Natural-language questions over the user's own numbers.
 *
 * The backend assembles a compact context from the database — the model never
 * receives raw rows, and every figure it quotes was computed by the pace engine.
 */
export function ChatView({ initialMessages }: { initialMessages: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || busy) return;

    setError(null);
    setQuestion("");
    setBusy(true);
    // Optimistic echo so the question appears the moment it is sent.
    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [...current, { id: pendingId, role: "USER", content: trimmed }]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : (body.error ?? "Could not answer that."));
        setMessages((current) => current.filter((m) => m.id !== pendingId));
        setQuestion(trimmed);
        return;
      }

      setMessages((current) => [
        ...current,
        { id: `answer-${Date.now()}`, role: "ASSISTANT", content: body.answer, model: body.model },
      ]);
    } catch {
      setError("Could not reach the server. Try again.");
      setMessages((current) => current.filter((m) => m.id !== pendingId));
      setQuestion(trimmed);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    await fetch("/api/ai/chat", { method: "DELETE" });
    setMessages([]);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="card min-h-[320px] p-4">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">Ask anything about your own performance.</p>
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn("flex", message.role === "USER" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed",
                    message.role === "USER"
                      ? "bg-[var(--accent)] text-[var(--accent-text)]"
                      : "bg-[var(--surface-raised)] text-[var(--text)]",
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.model && (
                    <p className="mt-1.5 font-mono text-[10px] opacity-60">{message.model}</p>
                  )}
                </div>
              </li>
            ))}
            {busy && (
              <li className="flex justify-start">
                <div className="rounded-2xl bg-[var(--surface-raised)] px-4 py-3">
                  <span className="flex gap-1" aria-label="Thinking">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="size-1.5 animate-bounce rounded-full bg-[var(--text-subtle)]"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <label htmlFor="chat-question" className="sr-only-focusable">
          Your question
        </label>
        <input
          id="chat-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your numbers…"
          autoComplete="off"
          className="h-11 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={question.trim().length < 2}>
          <Send className="size-4" aria-hidden="true" />
          <span className="sr-only-focusable sm:not-sr-only">Ask</span>
        </Button>
      </form>

      {messages.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1.5 self-start text-[12px] text-subtle hover:text-[var(--text)]"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Clear conversation
        </button>
      )}
    </div>
  );
}
