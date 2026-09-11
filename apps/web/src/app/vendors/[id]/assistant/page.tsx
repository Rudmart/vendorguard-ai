"use client";
import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";

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

export default function VendorAssistantPage() {
  const params = useParams();
  const vendorId = params?.id as string;
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!vendorId) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setVendorName(data.legalName ?? null);
      })
      .catch(() => {});
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "100vh", background: "#0f1526" }}>
      <div style={{ padding: "20px 32px", borderBottom: "1px solid #2e3d63" }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#e5e9f0" }}>AI Assistant</div>
        <div style={{ fontSize: 13, color: "#8b96ac", marginTop: 4 }}>
          {vendorName ? `Discussing: ${vendorName}` : "Loading vendor..."}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", maxWidth: 800, width: "100%", margin: "0 auto" }}>
        {messages.length === 0 && (
          <div style={{ color: "#8b96ac", fontSize: 14, textAlign: "center", marginTop: 60 }}>
            Ask me anything about {vendorName ?? "this vendor"} - risk, findings, evidence, or frameworks.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
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
                padding: "12px 16px",
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                color: "#e5e9f0",
              }}
            >
              {m.content}
            </div>
            {m.insufficientEvidence && (
              <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6 }}>
                Insufficient data to fully answer this question.
              </div>
            )}
            {m.promptInjectionFlagged && (
              <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>
                Possible prompt injection detected in this exchange.
              </div>
            )}
            {m.citations && m.citations.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {m.citations.map((c, ci) => (
                  <div
                    key={ci}
                    style={{
                      fontSize: 11.5,
                      color: "#8b96ac",
                      background: "#0f1526",
                      border: "1px solid #2e3d63",
                      borderRadius: 6,
                      padding: "8px 10px",
                      marginTop: 6,
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
        {loading && <div style={{ color: "#8b96ac", fontSize: 13 }}>Thinking...</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "20px 32px", borderTop: "1px solid #2e3d63" }}>
        <div style={{ display: "flex", gap: 10, maxWidth: 800, width: "100%", margin: "0 auto" }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendQuestion();
            }}
            disabled={!vendorId}
            placeholder={vendorId ? "Ask a question..." : "Loading vendor..."}
            style={{
              flex: 1,
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#e5e9f0",
              fontSize: 14,
            }}
          />
          <button
            onClick={sendQuestion}
            disabled={!vendorId || loading}
            style={{
              background: "#3b82f6",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              color: "#fff",
              fontSize: 14,
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