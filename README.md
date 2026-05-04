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

## Keycloak Setup

ใน realm `blood-sugar` ให้สร้าง client:

- Client ID: `blood-sugar-api`
- Client authentication: `Off` สำหรับ public client
- Standard flow: `On`
- Direct access grants: `On`

Backend ใช้ admin user จาก env เพื่อสร้าง user ใน Keycloak ผ่าน `/auth/register`. ค่า dev default คือ `admin` / `admin` จาก `docker-compose.yml`.

## Environment

Required:

- `DATABASE_URL`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_ADMIN_USERNAME`
- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_JWKS_URL`
- `PORT`
- `NODE_ENV`

Optional:

- `KEYCLOAK_CLIENT_SECRET`
- `KEYCLOAK_ISSUER`
- `KEYCLOAK_AUDIENCE`
- `REDIS_URL`

## API

Auth:

```http
POST /auth/register
POST /auth/login
GET  /auth/me
```

Register/login จะคุยกับ Keycloak โดยตรงเพื่อให้ password ถูกเก็บใน Keycloak เท่านั้น ไม่เก็บใน PostgreSQL.

ตัวอย่าง register:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","name":"Demo User"}'
```

ตัวอย่าง login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
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
