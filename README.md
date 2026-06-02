# Blood Sugar Tracking Backend

Backend API สำหรับแอปติดตามระดับน้ำตาลในเลือด ใช้ Fastify, Prisma, PostgreSQL และ Keycloak SSO.

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

## Keycloak Setup

ใน realm `blood-sugar` ให้สร้าง client:

- Client ID: `blood-sugar-api`
- Client authentication: `Off` สำหรับ public client
- Standard flow: `On`
- Direct access grants: `On`

Backend ใช้ admin user จาก env เพื่อสร้าง user ใน Keycloak ผ่าน `/auth/register`. ค่า dev default คือ `admin` / `admin` จาก `docker-compose.yml`.

ถ้าจะใช้ `/auth/password/forgot/request` ต้องตั้งค่า SMTP และ `RESET_OTP_SECRET` ใน `.env` ด้วย.
ค่าใน `.env.example` ใช้ Mailpit จาก `docker-compose.yml` ได้ทันทีสำหรับ local development.

## Environment

Required:

- `DATABASE_URL`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_ADMIN_USERNAME`
- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_JWKS_URL`
- `RESET_OTP_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `PORT`
- `NODE_ENV`

Optional:

- `KEYCLOAK_CLIENT_SECRET`
- `KEYCLOAK_ISSUER`
- `KEYCLOAK_AUDIENCE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `REDIS_URL`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`
- `RBAC_SYNC_ON_START`

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

The bootstrap command creates the Keycloak user if needed, sets the configured password, creates the local app user, and assigns the `Admin` role.

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
