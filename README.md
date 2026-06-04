# Blood Sugar Tracking Backend

Backend API สำหรับแอปติดตามระดับน้ำตาลในเลือด ใช้ Fastify, Prisma, PostgreSQL และ local JWT auth.

## Requirements

- Node.js 20+
- Docker / Docker Compose

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d
npx prisma migrate dev
npm run admin:bootstrap
npm run dev
```

API จะรันที่ `http://localhost:3000`.
Mailpit สำหรับดูอีเมล local จะอยู่ที่ `http://localhost:8025`.

## Auth Setup

Backend ออก local JWT เองและเก็บ password hash ใน App DB. ตั้ง `JWT_SECRET` ให้เป็น secret อย่างน้อย 32 characters ใน production.

Keycloak env ใช้เฉพาะช่วง import ผู้ใช้เดิมด้วย `KEYCLOAK_USER_MIGRATION_ON_DEPLOY=true`; runtime auth ไม่ verify token ผ่าน Keycloak แล้ว.
Production deploy runs database migration, RBAC sync, and optional Keycloak user import through `npm run deploy:migrate` at container startup; `npm run build` does not connect to the database.

ถ้าจะใช้ `/auth/password/forgot/request` ต้องตั้งค่า SMTP และ `RESET_OTP_SECRET` ใน `.env` ด้วย.
ค่าใน `.env.example` ใช้ Mailpit จาก `docker-compose.yml` ได้ทันทีสำหรับ local development.

## Environment

Required:

- `DATABASE_URL`
- `DIRECT_URL` for Prisma migrations when runtime uses a pooler connection
- `JWT_SECRET`
- `RESET_OTP_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `PORT`
- `NODE_ENV`

Optional:

- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `KEYCLOAK_USER_MIGRATION_ON_DEPLOY`
- `KEYCLOAK_USER_MIGRATION_FORCE_EMAIL`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_ADMIN_USERNAME`
- `KEYCLOAK_ADMIN_PASSWORD`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `REDIS_URL`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ADMIN_BOOTSTRAP_ON_START`
- `RBAC_SYNC_ON_START`
- `BACKUP_CRON_SECRET`
- `BACKUP_TEMP_DIR`
- `BACKUP_ENVIRONMENT`
- `BACKUP_PG_DUMP_PATH`
- `BACKUP_INCLUDE_SQL`
- `BACKUP_INCLUDE_EXCEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BACKUP_BUCKET`

Backup Center ต้องมี `pg_dump` ใน runtime ก่อนเรียก backup จริง และต้องตั้งค่า Supabase Storage env ให้ครบเพื่อ upload zip เข้า private bucket. Cron endpoint ใช้ `x-backup-secret` ไม่ใช้ query string. External drive service account env ถูกถอดออกแล้ว; อย่าใส่ private key ของ drive provider ใน env ของระบบนี้.

## Roles and Permissions

RBAC is stored in the app database. Permissions are a fixed code catalog in `src/rbac/permissions.ts`; roles are managed from backoffice APIs.

By default, the backend syncs this catalog on app start when `RBAC_SYNC_ON_START=true`. You can also run the sync manually:

```bash
npm run permissions:sync
```

The sync is non-destructive: it creates/updates permission metadata, grants all permissions to the system `Admin` role, and grants only self-service permissions to the system `User` role. Custom roles do not receive new permissions automatically.

When a new self-service feature is added to the catalog, existing users with the system `User` role receive those new self permissions automatically after the next sync.

Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`, then run:

```bash
npm run admin:bootstrap
```

When `INITIAL_ADMIN_BOOTSTRAP_ON_START=true`, the app creates the local admin user if missing and assigns the `Admin` role on startup. It does not reset the password on every restart.

The bootstrap command creates or updates the local app user password and assigns the `Admin` role. Use it when you need to reset the initial admin password manually.

## API

Auth:

```http
POST /auth/register
POST /auth/login
GET  /auth/me
POST /auth/password/reset
POST /auth/password/forgot/request
POST /auth/password/forgot/confirm
```

Register/login จะคุยกับ Keycloak โดยตรงเพื่อให้ password ถูกเก็บใน Keycloak เท่านั้น ไม่เก็บใน PostgreSQL.

ตัวอย่าง register:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","firstName":"Demo","lastName":"User"}'
```

ตัวอย่าง login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

ตัวอย่าง reset password เมื่อยังจำรหัสเดิมได้:

```bash
curl -X POST http://localhost:3000/auth/password/reset \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"currentPassword":"password123","newPassword":"new-password"}'
```

ตัวอย่าง forgot password:

```bash
curl -X POST http://localhost:3000/auth/password/forgot/request \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

หลังจากผู้ใช้ได้รับ OTP ทางอีเมล:

```bash
curl -X POST http://localhost:3000/auth/password/forgot/confirm \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","otp":"123456","newPassword":"new-password"}'
```

เอา `access_token` ที่ได้ไปใช้กับ endpoint อื่น:

```http
Authorization: Bearer <keycloak-access-token>
```

Routes:

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/password/reset`
- `POST /auth/password/forgot/request`
- `POST /auth/password/forgot/confirm`
- `GET /records`
- `POST /records`
- `PUT /records/:id`
- `DELETE /records/:id`
- `GET /profile`
- `PUT /profile`
- `GET /dashboard?range=7d|30d|all`
- `GET /export?type=excel|pdf`
- `GET /backoffice/permissions`
- `GET /backoffice/roles`
- `POST /backoffice/roles`
- `GET /backoffice/roles/:id`
- `PUT /backoffice/roles/:id`
- `DELETE /backoffice/roles/:id`
- `GET /backoffice/users`
- `GET /backoffice/users/:id`
- `PUT /backoffice/users/:id/profile`
- `PUT /backoffice/users/:id/roles`
- `POST /internal/backup/run`
- `POST /backoffice/backups/run`
- `GET /backoffice/backups`

Error format:

```json
{
  "ok": false,
  "error": "message"
}
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run prisma:migrate
```
