# Azure Deployment Notes

## Status: Database deployed (Part 1 of 3)

### What's live in Azure right now
- **Resource Group**: `vendorguard-prod-rg` (region: East US 2)
- **Postgres Server**: `vendorguard-db-2026`
  - Host: `vendorguard-db-2026.postgres.database.azure.com`
  - Admin user: `vgadmin`
  - Database name: `vendorguard`
  - Firewall: currently open to all IPs (`0.0.0.0`-`255.255.255.255`) - fine for setup, should be restricted before going fully live
- All Prisma migrations have been applied - the cloud database has the same 26+ table schema as local, but is empty (no vendors/tenants yet)

### Still to do (future session)
1. **Deploy the API** (Fastify server) to Azure - likely Azure App Service or Container Apps
   - Will need the Azure DATABASE_URL as an environment variable/secret (not committed to git)
   - Will need to update CORS origin once the web app has a real URL
2. **Deploy the web app** (Next.js) to Azure - likely Azure Static Web Apps or App Service
   - Will need to update all http://localhost:4000 references to the real deployed API URL
3. **Tighten security before going live**:
   - Restrict Postgres firewall to only the APIs outbound IP (not all IPs)
   - Move the admin password into Azure Key Vault or App Service secrets instead of plain text
   - Consider replacing the "dev persona" login with real Azure AD / Entra ID authentication

### Connection string (for reference - treat as sensitive)
postgresql://vgadmin:VendorGuard2026!Secure@vendorguard-db-2026.postgres.database.azure.com:5432/vendorguard?sslmode=require
