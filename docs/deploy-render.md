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

DATABASE_URL=<render-postgres-internal-database-url>

KEYCLOAK_BASE_URL=https://health-saas-auth.duckdns.org
KEYCLOAK_REALM=blood-sugar-dev
KEYCLOAK_CLIENT_ID=blood-sugar-dev-api
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=<keycloak-admin-password>
KEYCLOAK_JWKS_URL=https://health-saas-auth.duckdns.org/realms/blood-sugar-dev/protocol/openid-connect/certs
KEYCLOAK_ISSUER=https://health-saas-auth.duckdns.org/realms/blood-sugar-dev
KEYCLOAK_AUDIENCE=blood-sugar-dev-api

RESET_OTP_SECRET=<random-secret-at-least-32-characters>

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=ggasstock@gmail.com
SMTP_PASSWORD=<google-app-password>
SMTP_FROM="Health SaaS <ggasstock@gmail.com>"
```

## First Deploy

Before the first app start, run migrations against the Render database:

```bash
npx prisma migrate deploy
```

On Render, this can be run from a one-off shell if available, or from a temporary local command using the Render `DATABASE_URL`.

## Smoke Test

After deploy, test:

```bash
curl https://<render-service-url>/health
curl -X POST https://<render-service-url>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<existing-user-email>","password":"<password>"}'
```
