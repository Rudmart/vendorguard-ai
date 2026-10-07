import WorkflowGuide from "../workflow-guide";
import { AI_TPRM_STAGES } from "../workflow-guide-data";

export default function AiTprmWorkflowGuidePage() {
  return (
    <WorkflowGuide
      title="AI TPRM Workflow Guide"
      intro="How external AI providers and AI services are governed as Third-Party AI Risk (AI TPRM) - one module of the wider AI governance lifecycle. Each stage shows what it means, who is responsible and where it lives in VendorGuard. For the full lifecycle of AI systems, see the AI Governance Workflow Guide."
      stages={AI_TPRM_STAGES}
    />
  );
}