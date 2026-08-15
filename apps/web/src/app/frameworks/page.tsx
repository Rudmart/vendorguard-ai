import { cookies } from "next/headers";
import Link from "next/link";

type Framework = {
  frameworkId: string;
  frameworkName: string;
  version: string;
  controlCount: number;
};

async function getFrameworks() {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/frameworks`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (!res.ok) {
    throw new Error("Failed to fetch frameworks");
  }
  return res.json();
}

export default async function FrameworksPage() {
  const data = await getFrameworks();
  const frameworks: Framework[] = data.frameworks;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Framework Explorer</h1>
      <p style={{ color: "#8b96ac", marginBottom: 32 }}>
        {frameworks.length} frameworks available
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {frameworks.map((fw) => (
          <Link
            key={fw.frameworkId}
            href={`/frameworks/${fw.frameworkId}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              style={{
                background: "#111a2b",
                border: "1px solid #233150",
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 16 }}>{fw.frameworkName}</div>
              <div style={{ color: "#8b96ac", fontSize: 13, marginTop: 4 }}>
                Version {fw.version} &middot; {fw.controlCount} controls
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
