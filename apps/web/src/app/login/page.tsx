"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("http://localhost:4000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayName, email }),
      });

      if (!res.ok) {
        throw new Error("Login failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8, color: "#e9edf6" }}>VendorGuard AI</h1>
      <p style={{ color: "#8b96ac", marginBottom: 32 }}>Sign in to continue</p>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "#111a2b",
          border: "1px solid #233150",
          borderRadius: 10,
          padding: 24,
        }}
      >
        <label style={{ fontSize: 13, color: "#8b96ac" }}>
          Your Name
          <input
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #233150",
              background: "#0a0f1a",
              color: "#e9edf6",
              fontSize: 14,
              marginTop: 4,
              marginBottom: 16,
            }}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>

        <label style={{ fontSize: 13, color: "#8b96ac" }}>
          Email
          <input
            type="email"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #233150",
              background: "#0a0f1a",
              color: "#e9edf6",
              fontSize: 14,
              marginTop: 4,
              marginBottom: 16,
            }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {error && <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 14,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
            width: "100%",
          }}
        >
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
