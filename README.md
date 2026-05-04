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
