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

### API deployment progress (session 2) - blocked on Azure quota
- Created App Service Plan vendorguard-plan (Linux, F1 free tier, region westus2 - different region from the database, which is fine)
- Created Web App vendorguard-api-2026 on that plan, Node 22 LTS runtime
- Set DATABASE_URL and WEB_ORIGIN app settings on the Web App
- Updated API code to read process.env.PORT and process.env.WEB_ORIGIN instead of hardcoded values
- Added binaryTargets = ["native", "debian-openssl-3.0.x"] to packages/database/prisma/schema.prisma so Prisma works on Azure Linux (regenerate with pnpm exec prisma generate after pulling this change)
- Bundled the API into one file with esbuild since plain node_modules zips break due to pnpm symlinks on Windows:
  pnpm exec esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/bundle.js --external:@prisma/client --external:.prisma
- IMPORTANT: zip files must use forward-slash internal paths, not Windows backslashes, or Azure Linux deployment fails. Use this Python script instead of Compress-Archive or .NET ZipFile:
  import zipfile, os
  zf = zipfile.ZipFile("api-deploy.zip", "w", zipfile.ZIP_DEFLATED)
  for root, dirs, files in os.walk("dist"):
      for file in files:
          filepath = os.path.join(root, file)
          arcname = os.path.relpath(filepath, "dist").replace(os.sep, "/")
          zf.write(filepath, arcname)
  zf.close()
- Deployed successfully (file transfer worked) but app failed to start within Azures 10-minute timeout, then hit QuotaExceeded (free tier CPU limits, likely from repeated deploy attempts today)

BLOCKER: both paths are blocked by Azure account-level quotas, not our code:
- Paid tier (B1+): zero VM quota on this subscription, needs a Microsoft quota increase request
- Free tier (F1): hit its own CPU quota today, typically resets within a few hours

NEXT SESSION, try in this order:
1. Wait a few hours, retry deploying to existing vendorguard-api-2026 with the existing api-deploy.zip
2. If it deploys but wont start, check logs immediately with: az webapp log tail --resource-group vendorguard-prod-rg --name vendorguard-api-2026
3. Consider requesting an Azure VM quota increase in the Azure Portal Quotas page as a backup, since approval can take time

IMPORTANT DISCOVERY (session 2, later): The QuotaExceeded state is tracked at the whole-subscription level, not per App Service Plan or per region. Creating a brand new plan (vendorguard-plan-2) in a completely different region (centralus) hit the identical QuotaExceeded state almost immediately - confirming this cant be routed around within the same Azure account. A second Web App (vendorguard-api-2026b) was also created on this new plan and has DATABASE_URL and WEB_ORIGIN already set, ready to redeploy once quota clears.

NEXT SESSION: Just retry az webapp deploy against vendorguard-api-2026b using the existing apps/api/api-deploy.zip - no need to recreate any Azure resources. Check quota state first with:
az webapp show --resource-group vendorguard-prod-rg --name vendorguard-api-2026b --query "{state:state}" -o json
If it still says QuotaExceeded, wait longer before retrying - repeated attempts while blocked dont help and may extend the reset window.
