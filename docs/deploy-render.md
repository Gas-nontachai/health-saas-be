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

JWT_SECRET=<random-secret-at-least-32-characters>
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

RESET_OTP_SECRET=<random-secret-at-least-32-characters>

RESEND_API_KEY=<resend-api-key>
MAIL_FROM="Health SaaS <no-reply@your-verified-domain.com>"

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
- RBAC permission sync

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
