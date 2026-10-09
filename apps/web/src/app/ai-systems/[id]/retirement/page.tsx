"use client";
import { useParams } from "next/navigation";
import RetirementPanel from "../../../ai-retirements/retirement-panel";
export default function SystemRetirement() {
  const { id } = useParams<{ id: string }>();
  return <RetirementPanel systemId={id} />;
}
