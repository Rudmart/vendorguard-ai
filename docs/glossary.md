
## `pnpm exec prisma migrate dev --name <name>`

- `pnpm exec` - runs a tool installed just for this project, not globally
- `prisma` - the database management tool
- `migrate dev` - compares schema.prisma (the blueprint) to the real
  database, and applies whatever changed, safely, for local dev
- `--name <name>` - a label for this migration so your history stays
  readable later (e.g. `add_ai_risk_scoring_fields`)

In short: turns a schema.prisma edit into a real change in the
Postgres database.

