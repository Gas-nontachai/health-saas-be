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

## Auth Setup

Backend ออก local JWT เองและเก็บ password hash ใน App DB. ตั้ง `JWT_SECRET` ให้เป็น secret อย่างน้อย 32 characters ใน production.

Access token เป็น JWT อายุเริ่มต้น 900 วินาที ส่วน refresh token เป็น opaque random token อายุ 30 วัน เก็บเฉพาะ SHA-256 hash ใน `RefreshSession`. Browser ต้องส่ง `X-Auth-Contract: cookie-v1` และ `credentials: "include"`; backend จะตั้ง HttpOnly cookie และไม่ส่ง refresh token ใน JSON. Production บังคับ `AUTH_REFRESH_COOKIE_SECURE=true`.

Production deploy runs database migration and RBAC sync through `npm run deploy:migrate` before startup; `npm run build` does not connect to the database.

ถ้าจะใช้ `/auth/password/forgot/request` ต้องตั้งค่า mail provider และ `RESET_OTP_SECRET` ใน `.env` ด้วย.
ระบบส่งอีเมลผ่าน Resend เท่านั้น โดยใช้ `RESEND_API_KEY` + `MAIL_FROM`.

## Environment

Required:

- `DATABASE_URL`
- `DIRECT_URL` for Prisma migrations when runtime uses a pooler connection
- `JWT_SECRET`
- `RESET_OTP_SECRET`
- `RESEND_API_KEY`
- `MAIL_FROM`
- `PORT`
- `NODE_ENV`

Optional:

- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `AUTH_ALLOWED_ORIGINS` (comma-separated exact origins; ห้ามใช้ `*`)
- `AUTH_LEGACY_JSON_REFRESH_ENABLED` (temporary rollout flag)

Advanced cookie overrides (ไม่ต้องตั้งค่าปกติ): `AUTH_REFRESH_COOKIE_NAME`, `AUTH_REFRESH_COOKIE_PATH`, `AUTH_REFRESH_COOKIE_DOMAIN`, `AUTH_REFRESH_COOKIE_SAME_SITE`, `AUTH_REFRESH_COOKIE_SECURE`, `AUTH_SESSION_CLEANUP_RETENTION_SECONDS`. Production default เป็น `SameSite=None; Secure`; development/test default เป็น `SameSite=Lax` และ `Secure=false`.
- `MAIL_TIMEOUT_MS`
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

When `INITIAL_ADMIN_BOOTSTRAP_ON_START=true`, the app creates the local admin user if missing, assigns the `Admin` role on startup, and resets that admin password to `INITIAL_ADMIN_PASSWORD` so the env value remains authoritative.

The bootstrap command creates or updates the local app user password and assigns the `Admin` role. Use it when you need to reset the initial admin password manually.

## API

Auth:

```http
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /auth/password/reset
POST /auth/password/forgot/request
POST /auth/password/forgot/confirm
```

Register/login ตรวจ password hash ใน PostgreSQL และสร้าง local auth session; ไม่มี Keycloak runtime.

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
  -H "X-Auth-Contract: cookie-v1" \
  -H "Origin: http://localhost:5173" \
  -c cookies.txt \
  -d '{"email":"user@example.com","password":"password123"}'
```

Refresh/logout ใช้ cookie โดยไม่มี refresh token ใน body:

```bash
curl -X POST http://localhost:3000/auth/refresh -H "X-Auth-Contract: cookie-v1" -H "Origin: http://localhost:5173" -b cookies.txt -c cookies.txt
curl -X POST http://localhost:3000/auth/logout -H "Origin: http://localhost:5173" -b cookies.txt
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
Authorization: Bearer <access_token>
```

Routes:

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
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
