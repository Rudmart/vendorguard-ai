
## `pnpm exec prisma migrate dev --name <name>`

- `pnpm exec` - runs a tool installed just for this project, not globally
- `prisma` - the database management tool
- `migrate dev` - compares schema.prisma (the blueprint) to the real
  database, and applies whatever changed, safely, for local dev
- `--name <name>` - a label for this migration so your history stays
  readable later (e.g. `add_ai_risk_scoring_fields`)

In short: turns a schema.prisma edit into a real change in the
Postgres database.


## EU AI Act Controls (EUAI-1 through EUAI-9)

### EUAI-1: AI system risk classification
Definition: Sorting an AI system into the Act's risk tiers (prohibited,
high-risk, limited-risk, minimal-risk) based on what it does and who
it affects.
Example: A resume-screening AI used in hiring gets classified as
"high-risk" because employment decisions affect people's livelihoods.

### EUAI-2: Prohibited practices screening
Definition: Checking that an AI system doesn't do things the Act
bans outright, regardless of risk tier (e.g. manipulative or
exploitative AI, social scoring).
Example: An AI that manipulates people through subliminal techniques
to influence their behavior would be a prohibited practice.

### EUAI-3: Risk management system for high-risk AI
Definition: An ongoing, documented process for identifying and
reducing risks throughout the AI system's life, not just a one-time
check.
Example: A credit-scoring AI has a written process for testing for
bias every quarter and updating the model if bias is found.

### EUAI-4: Data governance for high-risk AI training data
Definition: Rules ensuring the data used to train a high-risk AI
system is relevant, representative, and checked for errors or bias.
Example: A medical diagnosis AI's training data is reviewed to make
sure it includes patients of different ages, ethnicities, and sexes.

### EUAI-5: Technical documentation and record-keeping
Definition: Written records describing how the AI system works, what
data it uses, and how it was tested - kept available for regulators.
Example: A folder of documents describing a hiring AI's design,
training data sources, and test results, ready to show an auditor.

### EUAI-6: Human oversight measures for high-risk AI
Definition: Making sure a person can understand, monitor, and if
needed override or stop the AI system's decisions.
Example: A loan-approval AI flags any rejection for a human loan
officer to review before the applicant is notified.

### EUAI-7: Transparency obligations toward users
Definition: Telling people when they're interacting with an AI
system, so they aren't misled into thinking it's a human.
Example: A customer service chatbot states "You're chatting with an
AI assistant" at the start of the conversation.

### EUAI-8: Conformity assessment and CE marking (high-risk systems)
Definition: A formal check confirming a high-risk AI system meets
the Act's requirements before it can be legally sold or used in the
EU, similar to a safety certification.
Example: Before selling a high-risk hiring AI in the EU, the vendor
completes a conformity assessment and applies a CE mark to the product.

### EUAI-9: Post-market monitoring plan
Definition: A plan for continuing to watch how the AI system performs
and behaves after it's already deployed and in use.
Example: A vendor tracks real-world error rates of its diagnostic AI
after launch and investigates any spike in incorrect results.

## MCP Server (Model Context Protocol Server)
Definition: A controlled 'waiter' between an AI and an application's real data. Instead of the AI directly accessing a database (risky, unrestricted), it asks the MCP server for specific, predefined things (like get_vendor or get_risk), and the server checks who is asking (login, tenant, role) before returning anything, and logs every request for audit.
Example: VendorGuard's MCP Compliance Server lets the AI Assistant ask for a vendor's risk score without ever touching the database directly - every request is tenant-scoped and logged.

