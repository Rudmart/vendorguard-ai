"use client";
import { useParams } from "next/navigation";
import RetirementPanel from "../retirement-panel";
export default function RetirementDetail() {
  const { id } = useParams<{ id: string }>();
  return <RetirementPanel retirementId={id} />;
}
