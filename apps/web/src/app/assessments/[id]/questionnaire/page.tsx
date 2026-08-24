"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Question = {
  key: string;
  category: string;
  prompt: string;
  answerType: "boolean" | "scale" | "text" | "multiSelect";
};

type QuestionnaireResponseRow = {
  questionKey: string;
  answerJson: { value: boolean | string | string[] };
};

type QuestionnaireDetail = {
  id: string;
  status: string;
  responses: QuestionnaireResponseRow[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#5d6786",
  IN_PROGRESS: "#eab308",
  SUBMITTED: "#3b82f6",
  REVIEWED: "#f97316",
  APPROVED: "#22c55e",
};

export default function QuestionnairePage() {
  const params = useParams();
  const assessmentId = params.id as string;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDetail | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean | string | string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadOrCreate() {
    setLoading(true);
    const createRes = await fetch(`${apiUrl}/assessments/${assessmentId}/questionnaire`, {
      method: "POST",
      credentials: "include",
    });
    if (createRes.ok) {
      const data = await createRes.json();
      setQuestionnaire(data.questionnaire);
      setQuestions(data.questions);
    }
    setLoading(false);
  }

  async function refresh(id: string) {
    const res = await fetch(`${apiUrl}/questionnaires/${id}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setQuestionnaire(data.questionnaire);
      setQuestions(data.questions);
      const loaded: Record<string, boolean | string | string[]> = {};
      for (const r of data.questionnaire.responses) {
        loaded[r.questionKey] = r.answerJson.value;
      }
      setAnswers(loaded);
    }
  }

  useEffect(() => {
    loadOrCreate();
  }, [assessmentId]);

  function setAnswer(key: string, value: boolean | string | string[]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAnswers() {
    if (!questionnaire) return;
    setSaving(true);
    await fetch(`${apiUrl}/questionnaires/${questionnaire.id}/responses`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    await refresh(questionnaire.id);
    setSaving(false);
  }

  async function transition(action: "submit" | "review" | "approve") {
    if (!questionnaire) return;
    setSaving(true);
    await fetch(`${apiUrl}/questionnaires/${questionnaire.id}/${action}`, {
      method: "POST",
      credentials: "include",
    });
    await refresh(questionnaire.id);
    setSaving(false);
  }

  if (loading) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Loading questionnaire...</main>;
  }
  if (!questionnaire) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Questionnaire not found.</main>;
  }

  const statusColor = STATUS_COLORS[questionnaire.status] ?? "#5d6786";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI Vendor Risk Questionnaire</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 20 }}>
        Status:{" "}
        <span style={{ color: statusColor, fontWeight: 700 }}>
          {questionnaire.status.replace(/_/g, " ")}
        </span>
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {questions.map((q) => (
          <div
            key={q.key}
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "14px 18px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{q.prompt}</div>

            {q.answerType === "boolean" && (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => setAnswer(q.key, true)}
                  style={{
                    background: answers[q.key] === true ? "#22c55e" : "#141b2d",
                    color: answers[q.key] === true ? "#000" : "#c3cad9",
                    border: "1px solid #2e3d63",
                    borderRadius: 8,
                    padding: "6px 14px",
                    cursor: "pointer",
                  }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setAnswer(q.key, false)}
                  style={{
                    background: answers[q.key] === false ? "#ef4444" : "#141b2d",
                    color: answers[q.key] === false ? "#000" : "#c3cad9",
                    border: "1px solid #2e3d63",
                    borderRadius: 8,
                    padding: "6px 14px",
                    cursor: "pointer",
                  }}
                >
                  No
                </button>
              </div>
            )}

            {q.answerType === "text" && (
              <input
                type="text"
                value={(answers[q.key] as string) ?? ""}
                onChange={(e) => setAnswer(q.key, e.target.value)}
                style={{
                  background: "#141b2d",
                  color: "#c3cad9",
                  border: "1px solid #2e3d63",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 13,
                  width: "100%",
                }}
              />
            )}

            {q.answerType === "scale" && (
              <select
                value={(answers[q.key] as string) ?? ""}
                onChange={(e) => setAnswer(q.key, e.target.value)}
                style={{
                  background: "#141b2d",
                  color: "#c3cad9",
                  border: "1px solid #2e3d63",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              >
                <option value="">Select...</option>
                <option value="none">None</option>
                <option value="advisory">Advisory</option>
                <option value="spot-check">Spot-check</option>
                <option value="partial automation">Partial automation</option>
                <option value="full review">Full review</option>
                <option value="full automation">Full automation</option>
              </select>
            )}

            {q.answerType === "multiSelect" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["PII", "financial", "health", "biometric", "none"].map((opt) => {
                  const current = (answers[q.key] as string[]) ?? [];
                  const selected = current.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        const next = selected ? current.filter((v) => v !== opt) : [...current, opt];
                        setAnswer(q.key, next);
                      }}
                      style={{
                        background: selected ? "#3b82f6" : "#141b2d",
                        color: selected ? "#000" : "#c3cad9",
                        border: "1px solid #2e3d63",
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button
          disabled={saving}
          onClick={saveAnswers}
          style={{
            background: "#3b82f6",
            color: "#000",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Save Answers
        </button>
        <button
          disabled={saving}
          onClick={() => transition("submit")}
          style={{
            background: "#22c55e",
            color: "#000",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Submit
        </button>
        <button
          disabled={saving}
          onClick={() => transition("review")}
          style={{
            background: "#f97316",
            color: "#000",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Mark Reviewed
        </button>
        <button
          disabled={saving}
          onClick={() => transition("approve")}
          style={{
            background: "#22c55e",
            color: "#000",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Approve
        </button>
      </div>
    </main>
  );
}