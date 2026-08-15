import { cookies } from "next/headers";
import Link from "next/link";

type Control = {
  controlId: string;
  title: string;
  domain: string;
  summary: string;
  expectedEvidenceTypes: string[];
  validationGuidance: string;
};

type FrameworkDetail = {
  frameworkId: string;
  frameworkName: string;
  version: string;
  controls: Control[];
};

async function getFramework(frameworkId: string) {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/frameworks/${frameworkId}/controls`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export default async function FrameworkDetailPage({ params }: { params: { frameworkId: string } }) {
  const data: FrameworkDetail | null = await getFramework(params.frameworkId);

  if (!data) {
    return (
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
        <p>Framework not found.</p>
        <Link href="/frameworks" style={{ color: "#3b82f6" }}>Back to Framework Explorer</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <Link href="/frameworks" style={{ color: "#8b96ac", fontSize: 13, textDecoration: "none" }}>
        &larr; Back to Framework Explorer
      </Link>
      <h1 style={{ fontSize: 28, margin: "12px 0 4px 0" }}>{data.frameworkName}</h1>
      <p style={{ color: "#8b96ac", marginBottom: 32 }}>
        Version {data.version} &middot; {data.controls.length} controls
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.controls.map((c) => (
          <div
            key={c.controlId}
            style={{
              background: "#111a2b",
              border: "1px solid #233150",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{c.title}</div>
              <span style={{ fontSize: 11, color: "#5d6786", border: "1px solid #233150", borderRadius: 4, padding: "1px 6px" }}>
                {c.controlId}
              </span>
            </div>
            <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 2 }}>{c.domain}</div>
            <p style={{ fontSize: 13.5, marginTop: 8, marginBottom: 8 }}>{c.summary}</p>
            <div style={{ fontSize: 12, color: "#8b96ac" }}>
              Evidence: {c.expectedEvidenceTypes.join(", ")}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
