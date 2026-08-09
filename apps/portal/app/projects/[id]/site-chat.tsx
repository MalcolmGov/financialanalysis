"use client";

import { useEffect, useRef, useState } from "react";

export type SiteChatPage = { path: string; title: string; previewUrl: string };

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  meta?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speak(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}

export function SiteChatPanel(props: {
  projectId: string;
  pagePath: string;
  pageTitle: string;
  /** Legal / trading issuer for greetings — never portal project slug. */
  issuerName?: string | null;
  disabled?: boolean;
  /** Compact chrome when nested inside Customize drawer. */
  embedded?: boolean;
  /** Prefill composer (e.g. density / type prompts from Customize → Type). */
  draftPrompt?: string | null;
  onDraftPromptConsumed?: () => void;
  onPagesUpdated: (pages: SiteChatPage[], bust: number) => void;
}) {
  const issuer = (props.issuerName ?? "").trim() || "this issuer";
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      content: `Ask me to tweak layout, typography, spacing, nav, or copy on the ${issuer} results site. Figures stay locked unless you explicitly override.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [allowNumberOverride, setAllowNumberOverride] = useState(false);
  const [pendingOverride, setPendingOverride] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognitionCtor());
  }, []);

  useEffect(() => {
    if (!props.draftPrompt) return;
    setInput(props.draftPrompt);
    props.onDraftPromptConsumed?.();
    // Intentionally only react to draftPrompt string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draftPrompt]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  function append(role: ChatRole, content: string, meta?: string) {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content, meta },
    ]);
  }

  async function send(raw: string, opts?: { forceNumberOverride?: boolean }) {
    const text = raw.trim();
    if (!text || sending || props.disabled) return;

    const useOverride = Boolean(opts?.forceNumberOverride || allowNumberOverride);
    append("user", text);
    setInput("");
    setSending(true);
    setPendingOverride(false);

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      const res = await fetch(`/api/projects/${props.projectId}/site/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          pagePath: props.pagePath,
          history,
          allowNumberOverride: useOverride,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        applied?: boolean;
        patchesApplied?: number;
        targetPath?: string;
        previewBust?: number;
        pages?: SiteChatPage[];
        needsNumberOverride?: boolean;
        error?: string;
      };

      if (!res.ok) {
        append("system", data.error ?? res.statusText);
        return;
      }

      const reply = data.message ?? "Done.";
      const metaParts: string[] = [];
      if (data.applied) {
        metaParts.push(
          `Applied ${data.patchesApplied ?? 0} patch${(data.patchesApplied ?? 0) === 1 ? "" : "es"}`,
        );
        if (data.targetPath) metaParts.push(data.targetPath);
      } else if (data.needsNumberOverride) {
        metaParts.push("Number override required");
        setPendingOverride(true);
      }

      append("assistant", reply, metaParts.length ? metaParts.join(" · ") : undefined);
      if (voiceOut) speak(reply);

      if (data.applied && data.pages?.length && data.previewBust != null) {
        props.onPagesUpdated(data.pages, data.previewBust);
      }
    } catch (err) {
      append("system", err instanceof Error ? err.message : "Chat request failed");
    } finally {
      setSending(false);
    }
  }

  function toggleMic() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-ZA";
    let finalText = "";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]![0]!.transcript;
        if (event.results[i]!.isFinal) finalText += piece;
        else interim += piece;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText.trim()) setInput(finalText.trim());
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  return (
    <aside
      className={props.embedded ? "rs-site-chat rs-site-chat--embedded" : "rs-site-chat"}
      aria-label="Studio chat"
    >
      <div className="rs-site-chat__header">
        <div>
          {!props.embedded ? (
            <div className="rs-site-chat__eyebrow">Studio chat</div>
          ) : null}
          <div className="rs-site-chat__context">
            {props.embedded ? "Context · " : "Editing · "}
            {props.pageTitle}
          </div>
        </div>
        <label className="rs-site-chat__toggle" title="Read replies aloud (browser TTS)">
          <input
            type="checkbox"
            checked={voiceOut}
            onChange={(e) => {
              setVoiceOut(e.target.checked);
              if (!e.target.checked && typeof window !== "undefined") {
                window.speechSynthesis?.cancel();
              }
            }}
          />
          Voice out
        </label>
      </div>

      <div className="rs-site-chat__messages" ref={listRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "rs-site-chat__bubble rs-site-chat__bubble--user"
                : m.role === "system"
                  ? "rs-site-chat__bubble rs-site-chat__bubble--system"
                  : "rs-site-chat__bubble rs-site-chat__bubble--assistant"
            }
          >
            <p>{m.content}</p>
            {m.meta ? <span className="rs-site-chat__meta">{m.meta}</span> : null}
          </div>
        ))}
        {sending ? (
          <div className="rs-site-chat__bubble rs-site-chat__bubble--assistant rs-site-chat__bubble--pending">
            <p>Thinking &amp; applying…</p>
          </div>
        ) : null}
      </div>

      {pendingOverride ? (
        <div className="rs-site-chat__banner">
          <label className="rs-check">
            <input
              type="checkbox"
              checked={allowNumberOverride}
              onChange={(e) => setAllowNumberOverride(e.target.checked)}
              disabled={sending}
            />
            Allow number override for next send (Gate A/B figures may change)
          </label>
        </div>
      ) : null}

      <div className="rs-site-chat__composer">
        <textarea
          className="rs-field rs-site-chat__input"
          rows={3}
          value={input}
          disabled={sending || props.disabled}
          placeholder={`e.g. Tighten the masthead spacing on ${props.pageTitle}…`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="rs-site-chat__actions">
          {speechSupported ? (
            <button
              type="button"
              className={
                listening ? "rs-btn rs-btn--ghost rs-site-chat__mic is-live" : "rs-btn rs-btn--ghost rs-site-chat__mic"
              }
              disabled={sending || props.disabled}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Voice input (Web Speech)"}
              onClick={() => toggleMic()}
            >
              {listening ? "Listening…" : "Mic"}
            </button>
          ) : (
            <span className="rs-tiny rs-muted" title="SpeechRecognition not available in this browser">
              Mic unavailable
            </span>
          )}
          <button
            type="button"
            className="rs-btn rs-btn--primary"
            disabled={sending || props.disabled || !input.trim()}
            onClick={() => void send(input)}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </aside>
  );
}
