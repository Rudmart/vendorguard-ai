"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type ControlRow = {
  id: string;
  controlId: string;
  applicability: string;
  rationale: string | null;
  ownerUserId: string | null;
  implementationStatus: string;
  control: {
    id: string;
    controlId: string;
    title: string;
    summary: string;
    domain: string;
    frameworkVersion: { version: string; isCurrent: boolean; framework: { id: string; name: string } };
  };
  sourceApplicability: { id: string; status: string };
  owner: { id: string; displayName: string; email: string } | null;
  frameworkCurrentlyApplicable: boolean;
  linkedRisks: { id: string; title: string; assessmentId: string }[];
};

type Summary = {
  applicableFrameworks: number;
  needsReviewFrameworks: number;
  notApplicableFrameworks: number;
  mappedControls: number;
  applicableControls: number;
  notAssessedControls: number;
  notApplicableControls: number;
  controlsWithoutOwner: number;
  controlsFromFrameworksNoLongerApplicable: number;
  implementationReported: { notStarted: number; planned: number; implemented: number };
};

type ControlSet = {
  aiSystem: { id: string; name: string };
  summary: Summary;
  frameworks: { applicabilityId: string; frameworkId: string; name: string; status: string }[];
  controls: ControlRow[];
};

type Available = {
  framework: { id: string; name: string };
  applicabilityStatus: string | null;
  mappable: boolean;
  currentVersion: { id: string; version: string } | null;
  controls: { id: string; controlId: string; title: string; domain: string; alreadyMapped: boolean }[];
};

type UserOption = { id: string; label: string };

const APPLICABILITY_OPTIONS = [
  { value: "NOT_ASSESSED", label: "Not assessed" },
  { value: "APPLICABLE", label: "Applicable" },
  { value: "PARTIALLY_APPLICABLE", label: "Partially applicable" },
  { value: "NOT_APPLICABLE", label: "Not applicable" },
];
const IMPLEMENTATION_OPTIONS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "PLANNED", label: "Planned" },
  { value: "IMPLEMENTED", label: "Implemented (reported)" },
];
const IMPLEMENTED_HELP = "Organization reports this control as implemented. Not independently assessed or validated.";

const colors = { card: "#161e33", inset: "#0d1323", border: "#28324d", muted: "#8e9ab5", soft: "#c7d0e3", accent: "#3b82f6", warn: "#fbbf24", danger: "#f87171", ok: "#34d399" };
const card: CSSProperties = { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24, marginBottom: 20 };
const inset: CSSProperties = { background: colors.inset, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: colors.inset,
  color: "inherit",
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "inherit",
};
const button: CSSProperties = { background: colors.accent, color: "#ffffff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer" };
const quietButton: CSSProperties = { ...button, background: "transparent", border: `1px solid ${colors.border}`, color: colors.soft, fontWeight: 500 };

function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "8px 0" }}>
      {message}
    </p>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <span style={{ display: "block", marginBottom: 6 }}>{label}</span>
      {children}
      {help && <span style={{ display: "block", fontSize: 12, color: colors.muted, marginTop: 4 }}>{help}</span>}
    </label>
  );
}

function ControlEditor({ row, users, onSaved }: { row: ControlRow; users: UserOption[]; onSaved: () => void }) {
  const [applicability, setApplicability] = useState(row.applicability);
  const [rationale, setRationale] = useState(row.rationale ?? "");
  const [owner, setOwner] = useState(row.ownerUserId ?? "");
  const [implementation, setImplementation] = useState(row.implementationStatus);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changes: Record<string, unknown> = {};
  if (applicability !== row.applicability) {
    changes.applicability = applicability;
  }
  if (rationale !== (row.rationale ?? "")) {
    changes.rationale = rationale.trim() ? rationale : null;
  }
  if (owner !== (row.ownerUserId ?? "")) {
    changes.ownerUserId = owner || null;
  }
  if (implementation !== row.implementationStatus) {
    changes.implementationStatus = implementation;
  }
  const dirty = Object.keys(changes).length > 0;
  const needsRationale = applicability === "NOT_APPLICABLE" || applicability === "PARTIALLY_APPLICABLE";

  async function save() {
    setError(null);
    if (needsRationale && !rationale.trim()) {
      setError(
        applicability === "NOT_APPLICABLE"
          ? "Explain why this control does not apply to this AI system."
          : "Explain which portion of this control applies.",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/ai-system-controls/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Could not save this control (${res.status}).`);
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setSaving(false);
    }
  }

  const ownerOptions = users.some((u) => u.id === owner) || !owner ? users : [...users, { id: owner, label: row.owner?.displayName ?? owner }];

  return (
    <div style={{ ...inset, marginBottom: 12, borderLeft: `4px solid ${row.frameworkCurrentlyApplicable ? colors.accent : colors.warn}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {row.control.controlId}: {row.control.title}
          </div>
          <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {row.control.frameworkVersion.framework.name}, version {row.control.frameworkVersion.version}. Domain: {row.control.domain}
          </div>
        </div>
        {!row.frameworkCurrentlyApplicable && (
          <div style={{ fontSize: 12, color: colors.warn, maxWidth: 280 }}>
            Mapped from a framework that is no longer marked applicable. The mapping and its decisions are kept for history.
          </div>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <a href={"/ai-system-controls/" + row.id + "/evidence"} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
          {"Evidence & assurance ->"}
        </a>
      </div>
      {row.linkedRisks.length > 0 && (
        <p style={{ fontSize: 12, color: colors.soft, margin: "8px 0 0" }}>
          Linked to AI risk (from the AI Risk Assessment, read only): {row.linkedRisks.map((risk) => risk.title).join(", ")}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
        <Field label="Applicability to this AI system">
          <select style={input} value={applicability} onChange={(e) => setApplicability(e.target.value)}>
            {APPLICABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Control owner" help="Responsible for this control on this AI system (separate from the AI system owner).">
          <select style={input} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">No owner</option>
            {ownerOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Implementation status (reported)" help={implementation === "IMPLEMENTED" ? IMPLEMENTED_HELP : "A claim by the organization, not a test result."}>
          <select style={input} value={implementation} onChange={(e) => setImplementation(e.target.value)}>
            {IMPLEMENTATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label={needsRationale ? "Rationale (required)" : "Rationale (optional)"}>
          <textarea
            style={{ ...input, minHeight: 50 }}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={
              applicability === "PARTIALLY_APPLICABLE"
                ? "Which portion of this control applies"
                : applicability === "NOT_APPLICABLE"
                  ? "Why this control does not apply (this is a decision, not a failed control)"
                  : "Optional notes on this decision"
            }
          />
        </Field>
      </div>

      <ErrorText message={error} />
      <div style={{ marginTop: 10 }}>
        <button type="button" style={dirty ? button : { ...quietButton, cursor: "default" }} onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving..." : dirty ? "Save changes" : "No changes"}
        </button>
      </div>
    </div>
  );
}

export default function AiControlSetPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [set, setSet] = useState<ControlSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [filterFramework, setFilterFramework] = useState("");
  const [filterApplicability, setFilterApplicability] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [filterImplementation, setFilterImplementation] = useState("");

  const [pickFramework, setPickFramework] = useState("");
  const [available, setAvailable] = useState<Available | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mapping, setMapping] = useState(false);
  const [mapResult, setMapResult] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    fetch(`${API}/ai-systems/${id}/controls`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setLoadError(data?.error ?? `Could not load the AI control set (${res.status}).`);
          return;
        }
        setLoadError(null);
        setSet(data as ControlSet);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Could not reach the server. Check that the API is running.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/tenant-users`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok) {
          return;
        }
        const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : [];
        const options = list
          .map((item) => {
            const u = item as { id?: string; userId?: string; displayName?: string; name?: string; email?: string };
            const userId = u.id ?? u.userId ?? "";
            return { id: userId, label: u.displayName ?? u.name ?? u.email ?? userId };
          })
          .filter((u) => u.id);
        setUsers(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id || !pickFramework) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setAvailableError(null);
    fetch(`${API}/ai-systems/${id}/frameworks/${pickFramework}/available-controls`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setAvailableError(data?.error ?? `Could not load controls (${res.status}).`);
          return;
        }
        setAvailable(data as Available);
        setSelected([]);
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableError("Could not reach the server. Check that the API is running.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, pickFramework, reloadKey]);

  const page: CSSProperties = { maxWidth: 1050, margin: "0 auto", padding: "32px 24px" };

  if (loadError) {
    return (
      <main style={page}>
        <ErrorText message={loadError} />
      </main>
    );
  }
  if (!set) {
    return (
      <main style={page}>
        <p style={{ color: colors.muted }}>Loading AI control set...</p>
      </main>
    );
  }

  const current = set;
  const reload = () => setReloadKey((k) => k + 1);
  const mappableFrameworks = current.frameworks.filter((f) => f.status === "APPLICABLE" || f.status === "PARTIALLY_APPLICABLE");
  const ownerFilterOptions = Array.from(
    new Map(current.controls.filter((c) => c.owner).map((c) => [c.owner?.id ?? "", c.owner?.displayName ?? ""])).entries(),
  );

  const visible = current.controls.filter((row) => {
    if (filterFramework && row.control.frameworkVersion.framework.id !== filterFramework) {
      return false;
    }
    if (filterApplicability && row.applicability !== filterApplicability) {
      return false;
    }
    if (filterOwner === "__none" && row.ownerUserId) {
      return false;
    }
    if (filterOwner && filterOwner !== "__none" && row.ownerUserId !== filterOwner) {
      return false;
    }
    if (filterImplementation && row.implementationStatus !== filterImplementation) {
      return false;
    }
    return true;
  });

  const notYetMapped = available ? available.controls.filter((c) => !c.alreadyMapped).map((c) => c.id) : [];

  async function mapSelected() {
    setMapError(null);
    setMapResult(null);
    if (selected.length === 0) {
      setMapError("Select at least one control to map.");
      return;
    }
    setMapping(true);
    try {
      const res = await fetch(`${API}/ai-systems/${current.aiSystem.id}/controls`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlIds: selected }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok && res.status !== 400) {
        setMapError(data?.error ?? `Could not map controls (${res.status}).`);
        return;
      }
      if (data?.error) {
        setMapError(data.error);
        return;
      }
      const mapped = (data?.mapped ?? []).length;
      const skipped = (data?.skippedAlreadyMapped ?? []).length;
      const rejected = (data?.rejected ?? []) as { controlId: string; reason: string }[];
      const rejectedText = rejected.length > 0 ? ` ${rejected.length} rejected: ${Array.from(new Set(rejected.map((r) => r.reason))).join("; ")}.` : "";
      setMapResult(`${mapped} mapped, ${skipped} already mapped and skipped.${rejectedText}`);
      setSelected([]);
      reload();
    } catch {
      setMapError("Could not reach the server. Check that the API is running.");
    } finally {
      setMapping(false);
    }
  }

  const s = current.summary;
  const summaryItems: { label: string; value: number }[] = [
    { label: "Applicable frameworks", value: s.applicableFrameworks },
    { label: "Frameworks needing review", value: s.needsReviewFrameworks },
    { label: "Mapped controls", value: s.mappedControls },
    { label: "Applicable controls", value: s.applicableControls },
    { label: "Not yet assessed for applicability", value: s.notAssessedControls },
    { label: "Not applicable controls", value: s.notApplicableControls },
    { label: "Controls without an owner", value: s.controlsWithoutOwner },
    { label: "From frameworks no longer applicable", value: s.controlsFromFrameworksNoLongerApplicable },
  ];

  return (
    <main style={page}>
      <a href={`/ai-systems/${current.aiSystem.id}`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to {current.aiSystem.name}
      </a>
      <h1 style={{ fontSize: 26, marginTop: 12, marginBottom: 4 }}>AI Control Set</h1>
      <p style={{ color: colors.muted, marginTop: 0 }}>{current.aiSystem.name}</p>

      <section style={card}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What this page shows</h2>
        <p style={{ fontSize: 13, color: colors.soft, margin: "0 0 6px" }}>
          The controls from the framework library that have been assigned to this AI system for governance purposes.
        </p>
        <p style={{ fontSize: 13, color: colors.soft, margin: 0 }}>
          Mapping a control is not implementing it. Reported implementation is not proven effectiveness. Effectiveness alone
          is not compliance. Control assessment and evidence come in later steps, so this page shows no compliance score.
        </p>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Summary</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {summaryItems.map((item) => (
            <div key={item.label} style={inset}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{item.value}</div>
              <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: colors.soft, marginBottom: 0 }}>
          Reported implementation: {s.implementationReported.notStarted} not started, {s.implementationReported.planned} planned,{" "}
          {s.implementationReported.implemented} implemented (reported by the organization, not assessed or validated).
        </p>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Map controls from the library</h2>
        {mappableFrameworks.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>
            No framework is marked Applicable or Partially Applicable yet. Record framework decisions on the AI system page first.
          </p>
        ) : (
          <>
            <Field label="Framework">
              <select style={{ ...input, maxWidth: 420 }} value={pickFramework} onChange={(e) => setPickFramework(e.target.value)}>
                <option value="">Choose an applicable framework</option>
                {mappableFrameworks.map((f) => (
                  <option key={f.frameworkId} value={f.frameworkId}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorText message={availableError} />
            {available && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <button
                    type="button"
                    style={quietButton}
                    onClick={() => setSelected(notYetMapped)}
                    disabled={notYetMapped.length === 0}
                  >
                    Select all not yet mapped ({notYetMapped.length})
                  </button>
                  <button type="button" style={quietButton} onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                </div>
                <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                  {available.controls.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, opacity: c.alreadyMapped ? 0.55 : 1 }}>
                      <input
                        type="checkbox"
                        disabled={c.alreadyMapped}
                        checked={c.alreadyMapped || selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((value) => value !== c.id)))
                        }
                      />
                      <span>
                        <strong>{c.controlId}</strong> {c.title}
                        <span style={{ color: colors.muted }}> ({c.domain}{c.alreadyMapped ? ", already mapped" : ""})</span>
                      </span>
                    </label>
                  ))}
                </div>
                <ErrorText message={mapError} />
                {mapResult && <p style={{ color: colors.ok, fontSize: 13 }}>{mapResult}</p>}
                <button type="button" style={{ ...button, marginTop: 10 }} onClick={mapSelected} disabled={mapping || selected.length === 0}>
                  {mapping ? "Mapping..." : `Map selected (${selected.length})`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Controls assigned to this AI system</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 16 }}>
          <Field label="Framework">
            <select style={input} value={filterFramework} onChange={(e) => setFilterFramework(e.target.value)}>
              <option value="">All frameworks</option>
              {current.frameworks.map((f) => (
                <option key={f.frameworkId} value={f.frameworkId}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Applicability">
            <select style={input} value={filterApplicability} onChange={(e) => setFilterApplicability(e.target.value)}>
              <option value="">All</option>
              {APPLICABILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner">
            <select style={input} value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
              <option value="">All</option>
              <option value="__none">No owner</option>
              {ownerFilterOptions.map(([ownerId, name]) => (
                <option key={ownerId} value={ownerId}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Implementation (reported)">
            <select style={input} value={filterImplementation} onChange={(e) => setFilterImplementation(e.target.value)}>
              <option value="">All</option>
              {IMPLEMENTATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {current.controls.length === 0 && <p style={{ color: colors.muted }}>No controls mapped yet.</p>}
        {current.controls.length > 0 && visible.length === 0 && <p style={{ color: colors.muted }}>No controls match these filters.</p>}
        <p style={{ fontSize: 12, color: colors.muted }}>
          Showing {visible.length} of {current.controls.length}. {optionLabel(IMPLEMENTATION_OPTIONS, "IMPLEMENTED")} means: {IMPLEMENTED_HELP}
        </p>
        {visible.map((row) => (
          <ControlEditor key={`${row.id}-${reloadKey}`} row={row} users={users} onSaved={reload} />
        ))}
      </section>
    </main>
  );
}