"use client";
import { useList, link } from "../../_lists/ui";
export default function IncidentsCard({ aiSystemId }: { aiSystemId: string }) {
  const { data, error } = useList<{
    incidents: {
      id: string;
      title: string;
      status: string;
      severity: string;
    }[];
  }>(`/ai-systems/${aiSystemId}/incidents`);
  return (
    <section
      style={{
        background: "#1a2340",
        border: "1px solid #2e3d63",
        borderRadius: 10,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <h2>AI Incidents</h2>
      <a style={link} href={`/ai-incidents?aiSystemId=${aiSystemId}`}>
        View or register incidents
      </a>
      {error && <p>{error}</p>}
      {data?.incidents.map((i) => (
        <p key={i.id}>
          <a style={link} href={`/ai-incidents/${i.id}`}>
            {i.title}
          </a>{" "}
          � {i.severity} � {i.status}
        </p>
      ))}
      {data?.incidents.length === 0 && <p>No incidents recorded.</p>}
    </section>
  );
}
