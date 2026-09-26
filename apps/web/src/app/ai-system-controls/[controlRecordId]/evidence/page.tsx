"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type AssuranceStatus = "NO_EVIDENCE" | "PENDING_REVIEW" | "ACCEPTED" | "REJECTED";
type UserRef = { id: string; displayName: string; email: string };
type EvidenceDoc = {
  id: string;
  displayFilename: string;
  documentType: string;
  state: string;
  expirationDate: string | null;
  vendorId: string | null;
  aiSystemId: string | null;
  uploadedByUserId: string;
  sizeBytes: number;
  createdAt: string;
};
type Review = {
  id: string;
  decision: "ACCEPT" | "REJECT";
  rationale: string;
  previousStatus: string;
  newStatus: string;
  createdAt: string;
  reviewer: UserRef;
};
type EvidenceLink = {
  id: string;
  status: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED";
  submissionNote: string | null;
  submittedAt: string;
  evidenceDocument: EvidenceDoc;
  submittedBy: UserRef;
  reviews: Review[];
};
type ControlEvidenceResponse = {
  controlRecord: {
    id: string;
    aiSystemId: string;
    applicability: string;
    implementationStatus: string;
    control: { id: string; controlId: string; title: string; summary: string; expectedEvidenceTypes: string[] };
  };
  assuranceStatus: AssuranceStatus;
  links: EvidenceLink[];
};
type AvailableDoc = EvidenceDoc & {
  source: "AI_SYSTEM" | "VENDOR";
  usable: boolean;
  vendor: { id: string; legalName: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  NO_EVIDENCE: "No Evidence",
  PENDING_REVIEW: "Evidence Submitted / Pending Review",
  ACCEPTED: "Evidence Accepted",
  REJECTED: "Evidence Rejected",
};
const STATUS_COLOR: Record<string, string> = {
  NO_EVIDENCE: "#94a3b8",
  PENDING_REVIEW: "#fbbf24",
  ACCEPTED: "#4ade80",
  REJECTED: "#f87171",
};

const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 };
const field: CSSProperties = {
  background: "#0b1220",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 8,
};
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };
const heading: CSSProperties = { color: "#e5e7eb", fontSize: 15, margin: "0 0 10px 0" };

function Badge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#94a3b8";
  return (
    <span style={{ border: "1px solid " + color, color, borderRadius: 999, padding: "2px 10px", fontSize: 12, whiteSpace: "nowrap" }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
  if (res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Request failed (" + res.status + ")";
}

export default function ControlEvidencePage() {
  const params = useParams();
  const controlRecordId = String(params?.controlRecordId ?? "");

  const [data, setData] = useState<ControlEvidenceResponse | null>(null);
  const [available, setAvailable] = useState<AvailableDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedDocId, setSelectedDocId] = useState("");
  const [note, setNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rationales, setRationales] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!controlRecordId) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`${API}/ai-system-controls/${controlRecordId}/evidence`, { credentials: "include" });
      if (!res.ok) {
        if (!cancelled) {
          setError(res.status === 404 ? "Control not found" : "Could not load evidence (" + res.status + ")");
        }
        return;
      }
      const json = (await res.json()) as ControlEvidenceResponse;
      const res2 = await fetch(`${API}/ai-systems/${json.controlRecord.aiSystemId}/evidence`, { credentials: "include" });
      const json2 = res2.ok ? ((await res2.json()) as { evidence: AvailableDoc[] }) : { evidence: [] };
      if (!cancelled) {
        setData(json);
        setAvailable(json2.evidence);
      }
    };
    load().catch(() => {
      if (!cancelled) {
        setError("Could not load evidence");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [controlRecordId, reloadKey]);

  async function run(action: () => Promise<string | null>, success: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const err = await action();
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (err) {
      setError(err);
      return;
    }
    setMessage(success);
    if (after) {
      after();
    }
    setReloadKey((k) => k + 1);
  }

  if (!data) {
    return <main style={{ padding: 24, color: "#e5e7eb" }}>{error ?? "Loading..."}</main>;
  }

  const { controlRecord, assuranceStatus, links } = data;
  const aiSystemId = controlRecord.aiSystemId;
  const linkedIds = new Set(links.map((link) => link.evidenceDocument.id));
  const options = available.filter((doc) => doc.usable && !linkedIds.has(doc.id));
  const notApplicable = controlRecord.applicability === "NOT_APPLICABLE";

  return (
    <main style={{ padding: 24, color: "#e5e7eb", maxWidth: 1000 }}>
      <a href={`/ai-systems/${aiSystemId}/controls`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to AI control set
      </a>
      <h1 style={{ fontSize: 20, margin: "12px 0 4px 0" }}>
        {controlRecord.control.controlId} - {controlRecord.control.title}
      </h1>
      <p style={{ ...muted, fontSize: 13 }}>{controlRecord.control.summary}</p>
      <div style={{ margin: "12px 0 16px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={muted}>Assurance status:</span>
        <Badge status={assuranceStatus} />
        <span style={muted}>
          Applicability: {controlRecord.applicability} | Reported implementation: {controlRecord.implementationStatus}
        </span>
      </div>
      {controlRecord.control.expectedEvidenceTypes.length > 0 && (
        <p style={muted}>Expected evidence: {controlRecord.control.expectedEvidenceTypes.join(", ")}</p>
      )}
      <p style={muted}>
        Assurance status reflects human review of submitted evidence only. It is not a control test or an effectiveness rating.
      </p>

      {error && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...card, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      <section style={card}>
        <h2 style={heading}>Add AI-system evidence</h2>
        <input style={field} placeholder="Document type (e.g. Model card, Bias test report)" value={newType} onChange={(e) => setNewType(e.target.value)} />
        <input style={field} type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} />
        <input style={field} placeholder="Document name (for a record without a file)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button
          style={button}
          disabled={busy || !newName || !newType}
          onClick={() =>
            void run(
              () => post(`${API}/ai-systems/${aiSystemId}/evidence`, { displayFilename: newName, documentType: newType, expirationDate: newExpiry || undefined }),
              "Evidence record added.",
              () => setNewName(""),
            )
          }
        >
          Add record (no file)
        </button>
        <div style={{ marginTop: 12 }}>
          <input type="file" accept=".pdf,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, marginBottom: 8 }} />
          <br />
          <button
            style={button}
            disabled={busy || !file || !newType}
            onClick={() => {
              if (!file) {
                return;
              }
              const form = new FormData();
              form.append("documentType", newType);
              if (newExpiry) {
                form.append("expirationDate", newExpiry);
              }
              form.append("file", file);
              void run(() => post(`${API}/ai-systems/${aiSystemId}/evidence/upload`, form), "File uploaded.", () => setFile(null));
            }}
          >
            Upload file
          </button>
          <span style={muted}>PDF, DOCX or XLSX, max 25 MB. Uses the document type above.</span>
        </div>
      </section>

      <section style={card}>
        <h2 style={heading}>Submit evidence for review</h2>
        {notApplicable ? (
          <p style={muted}>This control is marked Not Applicable, so evidence cannot be submitted.</p>
        ) : (
          <>
            <p style={muted}>Choose evidence from this AI system or one of its linked vendors.</p>
            <select style={field} value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)}>
              <option value="">Select evidence...</option>
              {options.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.displayFilename} ({doc.documentType}) - {doc.source === "AI_SYSTEM" ? "AI system" : "Vendor: " + (doc.vendor?.legalName ?? "")}
                </option>
              ))}
            </select>
            <textarea style={field} rows={2} placeholder="Note for the reviewer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              style={button}
              disabled={busy || !selectedDocId}
              onClick={() =>
                void run(
                  () => post(`${API}/ai-system-controls/${controlRecordId}/evidence`, { evidenceDocumentId: selectedDocId, note }),
                  "Evidence submitted for review.",
                  () => {
                    setSelectedDocId("");
                    setNote("");
                  },
                )
              }
            >
              Submit for review
            </button>
            {options.length === 0 && <p style={muted}>No usable evidence available yet. Add AI-system evidence below.</p>}
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={heading}>Submissions and review history</h2>
        {links.length === 0 && <p style={muted}>No evidence submitted yet.</p>}
        {links.map((link) => (
          <div key={link.id} style={{ borderTop: "1px solid #1f2937", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>
                {link.evidenceDocument.displayFilename} <span style={muted}>({link.evidenceDocument.documentType})</span>
              </strong>
              <Badge status={link.status} />
            </div>
            <p style={muted}>
              Submitted by {link.submittedBy.displayName} ({link.submittedBy.email}) on {new Date(link.submittedAt).toLocaleString()}
              {link.submissionNote ? " - Note: " + link.submissionNote : ""}
            </p>
            {link.evidenceDocument.sizeBytes > 0 ? (
            <a href={`${API}/evidence/${link.evidenceDocument.id}/download`} style={{ color: "#93c5fd", fontSize: 12 }} target="_blank" rel="noreferrer">
              Open file
            </a>
            ) : (
              <span style={muted}>Record only (no file attached)</span>
            )}

            {link.status === "PENDING_REVIEW" && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  style={field}
                  rows={2}
                  placeholder="Reviewer rationale (required)"
                  value={rationales[link.id] ?? ""}
                  onChange={(e) => setRationales((prev) => ({ ...prev, [link.id]: e.target.value }))}
                />
                <button
                  style={{ ...button, background: "#15803d" }}
                  disabled={busy}
                  onClick={() =>
                    void run(() => post(`${API}/ai-control-evidence/${link.id}/review`, { decision: "ACCEPT", rationale: rationales[link.id] ?? "" }), "Evidence accepted.")
                  }
                >
                  Accept
                </button>
                <button
                  style={{ ...button, background: "#b91c1c" }}
                  disabled={busy}
                  onClick={() =>
                    void run(() => post(`${API}/ai-control-evidence/${link.id}/review`, { decision: "REJECT", rationale: rationales[link.id] ?? "" }), "Evidence rejected.")
                  }
                >
                  Reject
                </button>
                <span style={muted}>Reviewers only. You cannot review evidence you submitted or uploaded.</span>
              </div>
            )}

            {link.status === "REJECTED" && (
              <button
                style={{ ...button, marginTop: 8 }}
                disabled={busy}
                onClick={() => void run(() => post(`${API}/ai-control-evidence/${link.id}/resubmit`, {}), "Evidence resubmitted for review.")}
              >
                Resubmit for review
              </button>
            )}

            {link.reviews.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...muted, fontWeight: 600 }}>Human decisions</div>
                {link.reviews.map((review) => (
                  <p key={review.id} style={{ ...muted, margin: "4px 0" }}>
                    {new Date(review.createdAt).toLocaleString()} - {review.reviewer.displayName} ({review.reviewer.email}): {review.decision} - {review.rationale}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}