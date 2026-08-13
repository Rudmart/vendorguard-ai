
## SUCCESS - API is live! (session 3)

Live URL: https://vendorguard-api-container.delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io

Ended up using Azure Container Apps instead of App Service - App Service free tier CPU quota was too limited for this app to start within its timeout, kept crash-looping. Container Apps uses a separate Consumption quota pool that was not blocked, and does not have the same harsh startup timeout.

### All the real bugs found and fixed, in order:
1. pnpm workspace zip wont build on Azures auto-detect - Oryx builder only understands plain npm, chokes on workspace:* deps. Fix: bundle everything with esbuild first, deploy the bundle instead of source.
2. Windows zip tools use backslash paths - breaks Linux extraction. Fix: build zips with a Python script forcing forward slashes - became moot once we switched to Container Apps with a Dockerfile.
3. Azures auto-build (az containerapp up --source) ignores package.json main/type fields and always runs index.js as CommonJS - name the entry file index.js and bundle in CommonJS format (--format=cjs in esbuild), not ES modules.
4. az containerapp up auto-build appeared to cache stale images even with code changes - real fix was abandoning auto-detect entirely and writing an explicit Dockerfile, built via az acr build, for full control.
5. Prisma engine platform mismatch, twice: first needed debian-openssl-3.0.x (App Service Debian containers), then separately needed linux-musl-openssl-3.0.x (node:20-alpine Docker base image - Alpine uses musl libc not glibc, needs its own engine binary). Final binaryTargets in schema.prisma: ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x", "linux-musl"]
6. The bare linux-musl engine variant needs libssl.so.1.1, which modern Alpine does not ship - Prisma tried this variant first and failed. Fix: force the correct engine explicitly via Dockerfile ENV line: ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
7. npm install inside the Dockerfile was overwriting our pre-generated Prisma client (with correct engines) with a fresh unconfigured one. Fix: COPY .prisma and COPY @prisma steps happen AFTER RUN npm install, not before.
TEST MARKER 12345

### The working Dockerfile (in apps/api/dist/Dockerfile)
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY index.js .
COPY .prisma ./node_modules/.prisma
COPY @prisma ./node_modules/@prisma
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
EXPOSE 4000
CMD ["node", "index.js"]

### Full rebuild-and-redeploy process (for future API code changes)
cd packages\database
pnpm exec prisma generate
cd ..\..\apps\api
pnpm exec esbuild src\index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist\index.js --external:@prisma/client --external:.prisma
Remove-Item dist\.prisma -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item dist\@prisma -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path ..\..\node_modules\.pnpm\@prisma+client@5.20.0_prisma@5.20.0\node_modules\.prisma -Destination dist\.prisma -Recurse -Force
Copy-Item -Path ..\..\node_modules\.pnpm\@prisma+client@5.20.0_prisma@5.20.0\node_modules\@prisma -Destination dist\@prisma -Recurse -Force
docker build -t vendorguard-test -f dist\Dockerfile dist
docker run -p 4000:4000 vendorguard-test  (add -e DATABASE_URL and -e WEB_ORIGIN when testing)
docker tag vendorguard-test ca8c9cc7f33bacr.azurecr.io/vendorguard-api-container:NEW_TAG
az acr login --name ca8c9cc7f33bacr
docker push ca8c9cc7f33bacr.azurecr.io/vendorguard-api-container:NEW_TAG
az containerapp update --name vendorguard-api-container --resource-group vendorguard-prod-rg --image ca8c9cc7f33bacr.azurecr.io/vendorguard-api-container:NEW_TAG

### Azure resources created this session
- Container Apps Environment: vendorguard-env (region eastus2, Consumption workload profile)
- Container App: vendorguard-api-container
- Container Registry: ca8c9cc7f33bacr (auto-created)
- Also created but unused, can be cleaned up later: vendorguard-plan, vendorguard-plan-2 App Service plans, vendorguard-api-2026, vendorguard-api-2026b Web Apps - these hit the App Service CPU/quota wall and were abandoned in favor of Container Apps

### Still to do
- Deploy the web app (Next.js) - same general approach should work: Dockerfile plus Container Apps
- Update APIs WEB_ORIGIN env var once the web app has its real URL (currently still set to http://localhost:3000)
- Update web apps API calls to point to the real API URL instead of http://localhost:4000
- The Azure database has no Tenant/data yet (only local dev data exists) - will need to create a tenant via the API once the web app is live, or manually via a script
