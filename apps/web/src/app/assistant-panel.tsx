"use client";
import { useState, useRef, useEffect } from "react";

interface Citation {
  source: string;
  excerpt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  insufficientEvidence?: boolean;
  citations?: Citation[];
  promptInjectionFlagged?: boolean;
}

export default function AssistantPanel({
  isOpen,
  onClose,
  vendorId,
  vendorName,
}: {
  isOpen: boolean;
  onClose: () => void;
  vendorId: string | null;
  vendorName: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
  }, [vendorId]);

  async function sendQuestion() {
    if (!question.trim() || !vendorId || loading) return;
    const userQuestion = question;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: userQuestion }]);
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/assistant/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId, question: userQuestion }),
      });
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message.content,
          insufficientEvidence: data.message.insufficientEvidence,
          citations: data.message.citations,
          promptInjectionFlagged: data.message.promptInjectionFlagged,
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Could not reach the assistant." }]);
    }
    setLoading(false);
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        right: 0,
        bottom: 0,
        width: 420,
        background: "#141b2d",
        borderLeft: "1px solid #2e3d63",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #2e3d63",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>AI Assistant</div>
          <div style={{ fontSize: 11, color: "#8b96ac" }}>
            {vendorName ? `Discussing: ${vendorName}` : "Open a vendor to start"}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#8b96ac", fontSize: 18, cursor: "pointer" }}
          aria-label="Close"
        >
          &#10005;
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {!vendorId && (
          <div style={{ color: "#8b96ac", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            Navigate to a vendor's page to ask questions about it.
          </div>
        )}
        {vendorId && messages.length === 0 && (
          <div style={{ color: "#8b96ac", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            Ask me anything about {vendorName} - risk, findings, evidence, or frameworks.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                color: "#8b96ac",
                marginBottom: 4,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {m.role === "user" ? "You" : "AI Assistant"}
            </div>
            <div
              style={{
                background: m.role === "user" ? "#1a2340" : "#1e2a4a",
                border: "1px solid #2e3d63",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
            {m.insufficientEvidence && (
              <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                &#9888; Insufficient data to fully answer this question.
              </div>
            )}
            {m.promptInjectionFlagged && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                &#9888; Possible prompt injection detected in this exchange.
              </div>
            )}
            {m.citations && m.citations.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {m.citations.map((c, ci) => (
                  <div
                    key={ci}
                    style={{
                      fontSize: 10.5,
                      color: "#8b96ac",
                      background: "#0f1526",
                      border: "1px solid #2e3d63",
                      borderRadius: 6,
                      padding: "6px 8px",
                      marginTop: 4,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{c.source}</div>
                    <div>{c.excerpt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <div style={{ color: "#8b96ac", fontSize: 12 }}>Thinking...</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: 16, borderTop: "1px solid #2e3d63" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendQuestion();
            }}
            disabled={!vendorId}
            placeholder={vendorId ? "Ask a question..." : "Open a vendor first"}
            style={{
              flex: 1,
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 8,
              padding: "8px 12px",
              color: "#e5e9f0",
              fontSize: 13,
            }}
          />
          <button
            onClick={sendQuestion}
            disabled={!vendorId || loading}
            style={{
              background: "#3b82f6",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: vendorId ? "pointer" : "not-allowed",
              opacity: vendorId ? 1 : 0.5,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}