import WorkflowGuide from "../workflow-guide";
import { AI_GOVERNANCE_STAGES } from "../workflow-guide-data";

export default function AiGovernanceWorkflowGuidePage() {
  return (
    <WorkflowGuide
      title="AI Governance Workflow Guide"
      intro="How an AI system is governed end to end in the VendorGuard AI Governance Homelab - from identifying and registering AI, through risk and impact assessment, controls, evidence, testing, findings and treatment, to monitoring, reassessment and retirement. Each stage shows what it means, who is responsible and where it lives in VendorGuard."
      stages={AI_GOVERNANCE_STAGES}
    />
  );
}