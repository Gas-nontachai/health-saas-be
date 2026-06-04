# Deploy Backend on Render

This guide is for the `dev` backend environment.

## Render Services

Create these resources in Render:

- PostgreSQL database: `health-saas-db-dev`
- Web service: `health-saas-be-dev`

For the web service, use Docker deploy from this repository.

## Environment Variables

Set these values in the Render web service environment:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=<runtime-postgres-connection-url>
DIRECT_URL=<migration-postgres-connection-url>
OLD_DATABASE_IMPORT_ON_DEPLOY=false
OLD_DATABASE_URL=<old-render-postgres-connection-url>

JWT_SECRET=<random-secret-at-least-32-characters>
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

# Required for the initial cutover while importing existing users from Keycloak.
KEYCLOAK_USER_MIGRATION_ON_DEPLOY=true
KEYCLOAK_USER_MIGRATION_FORCE_EMAIL=true
KEYCLOAK_BASE_URL=https://health-saas-auth.duckdns.org
KEYCLOAK_REALM=blood-sugar-dev
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=<keycloak-admin-password>

RESET_OTP_SECRET=<random-secret-at-least-32-characters>

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=ggasstock@gmail.com
SMTP_PASSWORD=<google-app-password>
SMTP_FROM="Health SaaS <ggasstock@gmail.com>"

INITIAL_ADMIN_EMAIL=admin@test.com
INITIAL_ADMIN_PASSWORD=<first-admin-password>
INITIAL_ADMIN_BOOTSTRAP_ON_START=true
RBAC_SYNC_ON_START=true
```

## First Deploy

The Docker runtime command runs deploy migrations before starting the server. The build step does not connect to the database:

```bash
npm run deploy:migrate
node dist/src/server.js
```

`npm run deploy:migrate` runs:

- `npx prisma migrate deploy`
- Old database import when `OLD_DATABASE_IMPORT_ON_DEPLOY=true`
- RBAC permission sync
- Keycloak user migration when `KEYCLOAK_USER_MIGRATION_ON_DEPLOY=true`

For the initial Supabase cutover, set `OLD_DATABASE_IMPORT_ON_DEPLOY=true` and `OLD_DATABASE_URL` to the old Render PostgreSQL URL for one deploy. The import maps existing users by `id`, `keycloakId`, or `email`, then copies profile, blood sugar records, weight entries/goals, dashboard preferences, and shared links into Supabase. Turn `OLD_DATABASE_IMPORT_ON_DEPLOY=false` after the import succeeds so future deploys do not keep scanning the old database.

For the initial cutover from Keycloak, set `KEYCLOAK_USER_MIGRATION_ON_DEPLOY=true` while the Keycloak admin API is still reachable. The import is idempotent: it matches by legacy `keycloakId` or email, creates missing local users, assigns the default role/profile, stores a temporary password hash, marks `passwordChangeRequired=true`, and sends the temporary password by SMTP. It does not resend temporary passwords on rerun unless `KEYCLOAK_USER_MIGRATION_FORCE_EMAIL=true`.

The app creates the initial local admin user on start when `INITIAL_ADMIN_BOOTSTRAP_ON_START=true` and `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` are set. It also resets that admin password to `INITIAL_ADMIN_PASSWORD` on startup, so changing the env value intentionally changes the bootstrap admin login.

Run `npm run admin:bootstrap` only when you need to create/reset the initial admin manually.

## Smoke Test

After deploy, test:

```bash
curl https://<render-service-url>/health
curl -X POST https://<render-service-url>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<existing-user-email>","password":"<password>"}'
```

## Keepalive for Free Render Services

Render Free web services spin down after 15 minutes without inbound traffic. This repository includes a GitHub Actions workflow that can ping one or more `/health` URLs every 10 minutes.

In GitHub, configure a repository variable:

```text
KEEPALIVE_URLS=https://<prod-render-url>/health,https://<dev-render-url>/health
```

Notes:

- Scheduled GitHub Actions run from the default branch.
- Keeping a free service awake consumes Render free instance hours.
- If prod and dev are in the same Render workspace, two always-awake services can exceed the monthly free quota.
