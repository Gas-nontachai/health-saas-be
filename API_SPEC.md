# Health SaaS Backend — API Specification

Base URL: `http://localhost:3000`

## Authentication

Backend มี auth endpoints ให้ FE เรียกโดยตรง และออก **local JWT** จาก App DB โดยไม่พึ่ง Keycloak runtime

ทุก endpoint (ยกเว้น `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/password/forgot/*`, และ `POST /internal/backup/run`) ต้องส่ง **Bearer token** ผ่าน header:

```
Authorization: Bearer <access_token>
```

- Backend verify token ด้วย `JWT_SECRET` ภายในระบบ
- User ถูกค้นจาก App DB ด้วย token subject (`user.id`)
- ระบบจะโหลด `roles` และ `permissions` จาก App DB เพื่อให้ FE ใช้ซ่อน/โชว์เมนู และ backend ใช้ enforce ทุก protected endpoint
- หาก token ไม่ถูกต้อง/หมดอายุ จะได้ response `401`
- ถ้า user มี `passwordChangeRequired=true` จะเรียกได้เฉพาะ `GET /auth/me`, `POST /auth/password/change-required`, และ `POST /auth/password/reset`; API อื่นจะได้ `403` พร้อม error `PASSWORD_CHANGE_REQUIRED`

### FE Integration Flow (สรุป)

1. FE เรียก `POST /auth/register` หรือ `POST /auth/login`
2. Backend ตรวจ password hash ใน App DB แล้วส่ง `access_token` + `refresh_token`
3. FE เก็บ token และยิง API อื่นด้วย `Authorization: Bearer <access_token>`
4. Backend verify local JWT → load user roles/permissions → return data
5. เมื่อ `access_token` หมดอายุ FE เรียก `POST /auth/refresh` ด้วย `refreshToken`
6. ถ้า login response มี `requiresPasswordChange=true` FE ต้อง redirect ไปหน้าเปลี่ยนรหัสผ่านทันที

---

## Rate Limiting

- **100 requests** ต่อ **1 นาที** ต่อ IP

---

## Backup Environment

Backup Center ต้องตั้งค่า env ต่อไปนี้ก่อนเรียก backup จริง:

| Env | Required | Description |
|---|---:|---|
| `BACKUP_CRON_SECRET` | ✅ สำหรับ cron | secret สำหรับ `x-backup-secret` |
| `BACKUP_TEMP_DIR` | ❌ | temp directory, default `/tmp/backups` |
| `BACKUP_ENVIRONMENT` | ❌ | environment ที่เขียนใน manifest, default `development` |
| `BACKUP_PG_DUMP_PATH` | ❌ | absolute path ของ `pg_dump`; ถ้าไม่ตั้งค่าจะใช้ `pg_dump` จาก runtime PATH |
| `BACKUP_INCLUDE_SQL` | ❌ | default `true`; ถ้าเปิดจะสร้าง `database.sql` |
| `BACKUP_INCLUDE_EXCEL` | ❌ | default `true`; ถ้าเปิดจะสร้าง `database.xlsx` |
| `SUPABASE_URL` | ✅ สำหรับ backup | Supabase project URL เช่น `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ สำหรับ backup | service role key สำหรับ backend upload เข้า private Storage bucket; ห้ามส่งให้ frontend |
| `SUPABASE_BACKUP_BUCKET` | ✅ สำหรับ backup | private bucket สำหรับเก็บ backup zip |

Runtime ต้องมี `pg_dump` สำหรับ PostgreSQL dump. ถ้า binary ไม่อยู่ใน PATH ให้ตั้ง `BACKUP_PG_DUMP_PATH` เช่น `/opt/homebrew/bin/pg_dump` หรือ `/usr/bin/pg_dump`. ถ้า output ถูกปิดทั้งหมดหรือ Supabase Storage env ไม่ครบ ระบบจะสร้าง backup log แล้ว mark เป็น `failed`.

---

## Error Response Format

ทุก error จะมี format เดียวกัน:

```json
{
  "ok": false,
  "error": "<error message>"
}
```

| Status Code | Description |
|---|---|
| `400` | Validation error (Zod) หรือ Bad request |
| `401` | Missing / Invalid bearer token |
| `403` | Permission denied |
| `404` | Resource not found |
| `409` | Conflict (e.g. user already exists) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream integration error |

---

## Endpoints

### 1. Health Check

#### `GET /health`

ไม่ต้อง authentication

**Response** `200 OK`

```json
{
  "status": "ok",
  "uptime": 123.456
}
```

---

### 2. Auth

#### `POST /auth/register`

สมัครสมาชิก — สร้าง user ใน App DB แล้วส่ง local token กลับ (ไม่ต้อง authentication)

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | `string` | ✅ | valid email, จะถูก lowercase อัตโนมัติ |
| `password` | `string` | ✅ | min 8 characters |
| `firstName` | `string` | ❌ | min 1, max 60 characters |
| `lastName` | `string` | ❌ | min 1, max 60 characters |

**Request Body Example:**

```json
{
  "email": "user@example.com",
  "password": "MyStr0ngP@ss",
  "firstName": "สมชาย",
  "lastName": "ใจดี"
}
```

**Response** `201 Created`

```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 900,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "requiresPasswordChange": false,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "สมชาย ใจดี",
    "roles": ["User"],
    "permissions": ["auth.read.self", "profile.read.self"]
  }
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error (email format, password too short) |
| `409` | User already exists |

---

#### `POST /auth/login`

เข้าสู่ระบบ — ตรวจ email/password กับ App DB แล้วรับ local token กลับ (ไม่ต้อง authentication)

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | `string` | ✅ | valid email, จะถูก lowercase อัตโนมัติ |
| `password` | `string` | ✅ | min 1 character |

**Request Body Example:**

```json
{
  "email": "user@example.com",
  "password": "MyStr0ngP@ss"
}
```

**Response** `200 OK`

```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 900,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "requiresPasswordChange": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "สมชาย",
    "roles": ["User"],
    "permissions": ["auth.read.self"]
  }
}
```

ถ้า `requiresPasswordChange=true` FE ต้อง redirect ไปหน้าเปลี่ยนรหัสผ่าน และไม่ควรเรียก dashboard/health/profile/report APIs จนกว่าจะเปลี่ยนสำเร็จ

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error |
| `401` | Invalid email or password |

---

#### `GET /auth/me`

ดึงข้อมูล user ปัจจุบันจาก token (ต้อง authentication)

**Headers:** `Authorization: Bearer <access_token>`

**Response** `200 OK`

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "สมชาย",
  "roles": ["User"],
  "permissions": [
    "auth.read.self",
    "profile.read.self",
    "records.read.self",
    "weights.read.self"
  ],
  "passwordChangeRequired": false
}
```

FE should treat these permissions as UX hints only. Backend guards remain the source of truth for authorization.

---

#### `POST /auth/refresh`

ต่ออายุ token ด้วย refresh_token (ไม่ต้อง authentication)

> access_token หมดอายุตาม `ACCESS_TOKEN_TTL_SECONDS` (default 900 วินาที), refresh_token หมดอายุตาม `REFRESH_TOKEN_TTL_SECONDS` (default 30 วัน)  
> FE ควร refresh ก่อน access_token หมดอายุ หรือเมื่อได้ 401

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `refreshToken` | `string` | ✅ | min 1 character |

**Request Body Example:**

```json
{
  "refreshToken": "eyJhbGciOi..."
}
```

**Response** `200 OK`

```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 900,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "requiresPasswordChange": false,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "สมชาย",
    "roles": ["User"],
    "permissions": ["auth.read.self"]
  }
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error |
| `401` | Invalid or expired refresh token |

---

#### `POST /auth/password/reset`

เปลี่ยนรหัสผ่าน (ต้อง authentication — ต้องรู้รหัสผ่านเดิม)

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `currentPassword` | `string` | ✅ | min 1 character |
| `newPassword` | `string` | ✅ | min 8 characters |

**Request Body Example:**

```json
{
  "currentPassword": "OldP@ss123",
  "newPassword": "NewP@ss456"
}
```

**Response** `200 OK`

```json
{
  "message": "Password has been reset"
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error |
| `401` | Invalid current password / Missing token |

---

#### `POST /auth/password/change-required`

เปลี่ยนรหัสผ่านสำหรับ migrated user ที่ login ด้วย temporary password และยังมี `passwordChangeRequired=true`

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `currentPassword` | `string` | ✅ | temporary/current password, min 1 character |
| `newPassword` | `string` | ✅ | min 8 characters, ต้องต่างจาก current password |

**Request Body Example:**

```json
{
  "currentPassword": "Tmp-TemporaryPassword",
  "newPassword": "NewP@ss456"
}
```

**Response** `200 OK`

```json
{
  "message": "Password has been changed"
}
```

หลังสำเร็จ backend จะ set `passwordChangeRequired=false` และ user สามารถเรียก protected APIs อื่นได้ตาม permissions ปกติ

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error / new password ซ้ำกับ current password |
| `401` | Invalid current password / Missing token |

---

#### `POST /auth/password/forgot/request`

ขอ OTP สำหรับ reset password ส่งไปทาง email (ไม่ต้อง authentication)

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | `string` | ✅ | valid email, จะถูก lowercase อัตโนมัติ |

**Request Body Example:**

```json
{
  "email": "user@example.com"
}
```

**Response** `200 OK`

```json
{
  "message": "If the email exists, an OTP has been sent"
}
```

> Response จะเหมือนกันไม่ว่า email จะมีอยู่ในระบบหรือไม่ (ป้องกัน user enumeration)

> OTP มีอายุ **10 นาที** และลองผิดได้สูงสุด **5 ครั้ง**

---

#### `POST /auth/password/forgot/confirm`

ยืนยัน OTP แล้วตั้งรหัสผ่านใหม่ (ไม่ต้อง authentication)

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | `string` | ✅ | valid email, จะถูก lowercase อัตโนมัติ |
| `otp` | `string` | ✅ | 6 หลักตัวเลข (regex: `^\d{6}$`) |
| `newPassword` | `string` | ✅ | min 8 characters |

**Request Body Example:**

```json
{
  "email": "user@example.com",
  "otp": "482019",
  "newPassword": "NewP@ss456"
}
```

**Response** `200 OK`

```json
{
  "message": "Password has been reset"
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Invalid or expired OTP / Validation error |

---

### 3. Records (Blood Sugar)

#### `GET /records`

ดึง records ของ user ปัจจุบัน เรียงจากล่าสุดก่อน (cursor-based pagination สำหรับ infinite scroll)

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | `integer` | `20` | จำนวน records ต่อหน้า (1–100) |
| `cursor` | `string (uuid)` | — | `nextCursor` จาก response ก่อนหน้า เพื่อดึงหน้าถัดไป |

**Example:**
- หน้าแรก: `GET /records?limit=20`
- หน้าถัดไป: `GET /records?limit=20&cursor=<nextCursor>`

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "datetime": "2026-05-04T10:00:00.000Z",
      "bloodSugar": 120,
      "medMorning": 1,
      "medEvening": null,
      "note": "หลังอาหาร",
      "createdAt": "2026-05-04T10:00:00.000Z"
    }
  ],
  "nextCursor": "uuid-of-last-record-or-null",
  "totalCount": 57
}
```

> `nextCursor` จะเป็น `null` เมื่อไม่มีข้อมูลเพิ่มแล้ว
> `totalCount` คือจำนวน records ทั้งหมดของ user ปัจจุบัน ไม่ขึ้นกับ `limit` หรือ `cursor`

---

#### `POST /records`

สร้าง record ใหม่

**Headers:** `Authorization: Bearer <token>`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `datetime` | `string` | ✅ | ISO 8601 datetime with offset (e.g. `2026-05-04T10:00:00+07:00`) |
| `bloodSugar` | `integer` | ✅ | `0` หรือ `20-600`; `0` = ไม่ได้เจาะตรวจ |
| `medMorning` | `integer \| null` | ❌ | non-negative integer |
| `medEvening` | `integer \| null` | ❌ | non-negative integer |
| `note` | `string \| null` | ❌ | max 1000 characters |

**Request Body Example:**

```json
{
  "datetime": "2026-05-04T10:00:00+07:00",
  "bloodSugar": 120,
  "medMorning": 1,
  "medEvening": null,
  "note": "หลังอาหาร"
}
```

**Request Body Example (ไม่ได้เจาะตรวจ):**

```json
{
  "datetime": "2026-05-04T10:00:00+07:00",
  "bloodSugar": 0,
  "medMorning": 1,
  "medEvening": null,
  "note": "ไม่ได้เจาะตรวจ"
}
```

**Response** `201 Created`

```json
{
  "id": "uuid",
  "userId": "uuid",
  "datetime": "2026-05-04T03:00:00.000Z",
  "bloodSugar": 120,
  "medMorning": 1,
  "medEvening": null,
  "note": "หลังอาหาร",
  "createdAt": "2026-05-04T10:26:00.000Z"
}
```

---

#### `PUT /records/:id`

อัปเดต record (ต้องเป็นเจ้าของ record เท่านั้น)

**Headers:** `Authorization: Bearer <token>`

**Path Parameters:**

| Param | Type | Validation |
|---|---|---|
| `id` | `string` | UUID |

**Request Body:** (partial — ส่งเฉพาะ field ที่ต้องการแก้ไข, ต้องมีอย่างน้อย 1 field)

| Field | Type | Required | Validation |
|---|---|---|---|
| `datetime` | `string` | ❌ | ISO 8601 datetime with offset |
| `bloodSugar` | `integer` | ❌ | `0` หรือ `20-600`; `0` = ไม่ได้เจาะตรวจ |
| `medMorning` | `integer \| null` | ❌ | non-negative integer |
| `medEvening` | `integer \| null` | ❌ | non-negative integer |
| `note` | `string \| null` | ❌ | max 1000 characters |

**Request Body Example:**

```json
{
  "bloodSugar": 130,
  "note": "แก้ไขค่า"
}
```

**Request Body Example (แก้เป็นไม่ได้เจาะตรวจ):**

```json
{
  "bloodSugar": 0,
  "note": "ไม่ได้เจาะตรวจ"
}
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "userId": "uuid",
  "datetime": "2026-05-04T03:00:00.000Z",
  "bloodSugar": 130,
  "medMorning": 1,
  "medEvening": null,
  "note": "แก้ไขค่า",
  "createdAt": "2026-05-04T10:26:00.000Z"
}
```

**Error** `404 Not Found` — record ไม่มีอยู่หรือไม่ใช่เจ้าของ

---

#### `DELETE /records/:id`

ลบ record (ต้องเป็นเจ้าของ record เท่านั้น)

**Headers:** `Authorization: Bearer <token>`

**Path Parameters:**

| Param | Type | Validation |
|---|---|---|
| `id` | `string` | UUID |

**Response** `204 No Content` (empty body)

**Error** `404 Not Found` — record ไม่มีอยู่หรือไม่ใช่เจ้าของ

---

### 4. Profile

#### `GET /profile`

ดึง profile ของ user ปัจจุบัน (สร้างให้อัตโนมัติถ้ายังไม่มี) รวมข้อมูล email และ name จาก user

**Headers:** `Authorization: Bearer <token>`

**Response** `200 OK`

```json
{
  "id": "uuid",
  "userId": "uuid",
  "weight": 70.5,
  "height": 175.0,
  "createdAt": "2026-05-04T10:00:00.000Z",
  "email": "user@example.com",
  "name": "John Doe"
}
```

---

#### `PUT /profile`

อัปเดต profile (สร้างให้อัตโนมัติถ้ายังไม่มี) สามารถแก้ชื่อ/email ได้ใน App DB

**Headers:** `Authorization: Bearer <token>`

**Request Body:** (ต้องมีอย่างน้อย 1 field)

| Field | Type | Required | Validation |
|---|---|---|---|
| `firstName` | `string` | ❌ | min 1, max 100 |
| `lastName` | `string` | ❌ | min 1, max 100 |
| `email` | `string` | ❌ | valid email format |
| `weight` | `number \| null` | ❌ | positive number |
| `height` | `number \| null` | ❌ | positive number |

**Request Body Example:**

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "new@example.com",
  "weight": 72.3,
  "height": 175.0
}
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "userId": "uuid",
  "weight": 72.3,
  "height": 175.0,
  "createdAt": "2026-05-04T10:00:00.000Z",
  "email": "new@example.com",
  "name": "John Doe"
}
```

**Error** `409 Conflict` — email ซ้ำกับ user อื่น

---

### 5. Dashboard

#### `GET /dashboard`

ดึง dashboard widgets แบบ legacy สำหรับ blood sugar เท่านั้น — FE ใหม่ควรใช้ `GET /health/dashboard` เป็น canonical endpoint เพราะรองรับหลาย health data types และ widget preferences แบบแยก data type

ดึง dashboard widgets — FE เลือกได้ว่าจะแสดง widget ไหนบ้าง ถ้าข้อมูลไม่เพียงพอ widget จะบอก status `"insufficient_data"` พร้อม message

> `bloodSugar: 0` หมายถึงไม่ได้เจาะตรวจ และจะไม่ถูกนำไปคำนวณ widget ที่เป็นค่าสถิติน้ำตาลจริง เช่น avg/min/max, trend, time in range, distribution, daily pattern, weekly average, med comparison, recent alerts และ period comparison แต่ยังนับใน widget ที่เป็นพฤติกรรมการบันทึก/ยา เช่น `loggingStreak` และ `medAdherence`

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `range` | `string` | ❌ | `30d` | `7d`, `30d`, `all` |
| `widgets` | `string` | ❌ | default set | comma-separated widget keys เช่น `summary,trend,bmi` |

**Available Widgets:**

| Key | Description | ต้องการข้อมูลขั้นต่ำ |
|---|---|---|
| `summary` | สรุป avg / min / max / count | ≥ 1 measured record |
| `trend` | ข้อมูล line chart แบบ raw measured records ใน selected range (datetime + value) | ≥ 1 measured record |
| `timeInRange` | % Time in Range (Low < 70, Normal 70–180, High > 180) | ≥ 1 measured record |
| `distribution` | Histogram buckets (\<70, 70–100, 101–140, 141–180, 181–250, >250) | ≥ 1 measured record |
| `dailyPattern` | ค่าเฉลี่ยตามช่วงเวลา (morning/afternoon/evening/night) | ≥ 3 measured records |
| `weeklyAverage` | สรุปรายสัปดาห์ (avg, min, max) | ≥ 2 measured records |
| `medAdherence` | % วันที่กินยาครบ (morning/evening/both) | ≥ 1 record + มี med data |
| `medComparison` | เปรียบเทียบค่าน้ำตาล วันกินยา vs ไม่กินยา | ≥ 3 measured records + ต้องมีทั้งสอง |
| `loggingStreak` | จำนวนวันบันทึกติดต่อกัน + longest streak | ≥ 1 record |
| `recentAlerts` | 10 records ล่าสุดที่ Low / High | ≥ 1 measured record |
| `bmi` | คำนวณ BMI จาก profile | ต้องมี weight + height |
| `periodComparison` | เทียบค่าเฉลี่ยช่วงปัจจุบัน vs ช่วงก่อนหน้า | range ≠ `all` + ต้องมี measured records ทั้ง 2 ช่วง |

**Default Widgets:** `summary`, `trend`, `timeInRange`, `distribution`, `dailyPattern`, `medAdherence`, `recentAlerts`

**Response** `200 OK`

```json
{
  "range": "30d",
  "availableWidgets": [
    "summary", "trend", "timeInRange", "distribution", "dailyPattern",
    "weeklyAverage", "medAdherence", "medComparison", "loggingStreak",
    "recentAlerts", "bmi", "periodComparison"
  ],
  "defaultWidgets": [
    "summary", "trend", "timeInRange", "distribution",
    "dailyPattern", "medAdherence", "recentAlerts"
  ],
  "widgets": {
    "summary": {
      "status": "ok",
      "data": { "avg": 126, "min": 90, "max": 200, "count": 42 }
    },
    "trend": {
      "status": "ok",
      "data": [
        { "datetime": "2026-04-05T03:00:00.000Z", "value": 110 },
        { "datetime": "2026-04-06T03:00:00.000Z", "value": 130 }
      ]
    },
    "timeInRange": {
      "status": "ok",
      "data": {
        "total": 42,
        "low": { "count": 2, "percent": 4.8 },
        "normal": { "count": 35, "percent": 83.3 },
        "high": { "count": 5, "percent": 11.9 }
      }
    },
    "distribution": {
      "status": "ok",
      "data": [
        { "label": "<70", "count": 2 },
        { "label": "70-100", "count": 10 },
        { "label": "101-140", "count": 18 },
        { "label": "141-180", "count": 7 },
        { "label": "181-250", "count": 4 },
        { "label": ">250", "count": 1 }
      ]
    },
    "dailyPattern": {
      "status": "ok",
      "data": [
        { "slot": "morning", "avg": 115, "count": 12 },
        { "slot": "afternoon", "avg": 140, "count": 10 },
        { "slot": "evening", "avg": 130, "count": 15 },
        { "slot": "night", "avg": 105, "count": 5 }
      ]
    },
    "medAdherence": {
      "status": "ok",
      "data": {
        "totalDays": 30,
        "morning": { "days": 25, "percent": 83.3 },
        "evening": { "days": 20, "percent": 66.7 },
        "both": { "days": 18, "percent": 60.0 }
      }
    },
    "medComparison": {
      "status": "ok",
      "data": {
        "withMed": { "avg": 118, "count": 30 },
        "withoutMed": { "avg": 145, "count": 12 },
        "difference": 27
      }
    },
    "weeklyAverage": {
      "status": "ok",
      "data": [
        { "week": "2026-W14", "avg": 120, "min": 90, "max": 160, "count": 10 },
        { "week": "2026-W15", "avg": 130, "min": 95, "max": 200, "count": 12 }
      ]
    },
    "loggingStreak": {
      "status": "ok",
      "data": { "currentStreak": 5, "longestStreak": 14, "totalDaysLogged": 28 }
    },
    "recentAlerts": {
      "status": "ok",
      "data": [
        { "datetime": "2026-05-03T10:00:00.000Z", "bloodSugar": 210, "level": "high", "note": "หลังกินเค้ก" },
        { "datetime": "2026-05-01T06:00:00.000Z", "bloodSugar": 58, "level": "low", "note": null }
      ]
    },
    "bmi": {
      "status": "ok",
      "data": { "bmi": 23.0, "category": "Normal", "weight": 70.5, "height": 175.0 }
    },
    "periodComparison": {
      "status": "ok",
      "data": {
        "current": { "avg": 126, "count": 22 },
        "previous": { "avg": 135, "count": 20 },
        "change": -9
      }
    }
  }
}
```

**Widget status:**
- `"ok"` — ข้อมูลเพียงพอ ใช้งานได้
- `"insufficient_data"` — ข้อมูลไม่เพียงพอ มี `message` อธิบายเหตุผล, `data` อาจเป็น `null`

#### `GET /dashboard/preferences`

ดึง account-level dashboard widget preference ของ user ปัจจุบัน ใช้สำหรับให้ FE จัดลำดับและเลือกแสดง widget

**Headers:** `Authorization: Bearer <token>`

**Default behavior:** ถ้ายังไม่เคยบันทึก preference จะคืน default widgets ที่ normalize แล้ว

**Pinned summary rule:** backend จะ normalize ให้ `summary` เป็น widget ตัวแรกเสมอ, ตัด key ซ้ำ, และรับประกันว่ามีอย่างน้อย `summary`

**Response** `200 OK`

```json
{
  "widgets": ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"]
}
```

#### `PUT /dashboard/preferences`

บันทึก account-level dashboard widget preference ของ user ปัจจุบัน

**Headers:** `Authorization: Bearer <token>`

**Request Body**

```json
{
  "widgets": ["trend", "summary", "timeInRange", "bmi"]
}
```

**Validation / Normalization:**
- ทุก key ใน `widgets` ต้องอยู่ใน Available Widgets
- unknown widget key จะถูก reject ด้วย `400 Bad Request`
- duplicate key จะถูกตัด โดยรักษาลำดับแรกที่พบ
- `summary` จะถูก force เป็นตัวแรกเสมอ
- ถ้าส่ง `widgets: []` backend จะบันทึกและคืน `["summary"]`

**Response** `200 OK`

```json
{
  "widgets": ["summary", "trend", "timeInRange", "bmi"]
}
```

**Response** `400 Bad Request`

```json
{
  "ok": false,
  "error": "Unknown dashboard widget key"
}
```

**ตัวอย่าง widget ที่ข้อมูลไม่เพียงพอ:**

```json
{
  "bmi": {
    "status": "insufficient_data",
    "message": "Weight and height are required in profile to calculate BMI",
    "data": null
  }
}
```

---

### 6. Unified Health

Canonical health APIs live under `/health`. Legacy endpoints such as `/records`, `/dashboard`, `/export`, and `/health-progress/*` remain available during migration.

#### Supported Data Types

| Key | Description |
|---|---|
| `bloodSugar` | Blood sugar records and summaries |
| `weight` | Weight entries, goal, forecast, ETA |

#### `GET /health/dashboard`

Preferred unified dashboard endpoint. FE selects included health data with `dataTypes` and selected cards/charts with `widgets`. Response separates widget payloads by health data type so the same endpoint can power blood sugar only, weight only, or combined dashboards.

**Headers:** `Authorization: Bearer <token>`

**Permission:** `dashboard.read.self`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `range` | `string` | ❌ | `30d` | `7d`, `30d`, `all` |
| `dataTypes` | `string` | ❌ | `bloodSugar` | comma-separated: `bloodSugar`, `weight`, or `bloodSugar,weight` |
| `widgets` | `string` | ❌ | defaults per data type | comma-separated widget keys; each selected data type receives the requested widgets it supports |

**Widget keys by data type**

| Data Type | Available Widgets | Default Widgets |
|---|---|---|
| `bloodSugar` | `summary`, `trend`, `timeInRange`, `distribution`, `dailyPattern`, `weeklyAverage`, `medAdherence`, `medComparison`, `loggingStreak`, `recentAlerts`, `periodComparison` | `summary`, `trend`, `timeInRange`, `distribution`, `dailyPattern`, `medAdherence`, `recentAlerts` |
| `weight` | `summary`, `trend`, `forecast`, `goalProgress` | `summary`, `trend`, `forecast` |

If `widgets` contains a key unsupported by every selected data type, the API returns `400`. Example: `dataTypes=bloodSugar&widgets=forecast` is invalid. Example: `dataTypes=bloodSugar,weight&widgets=summary,trend,forecast` is valid; `forecast` is applied to `weight` only.

**Response shape**

```json
{
  "range": "30d",
  "dataTypes": ["bloodSugar", "weight"],
  "availableDataTypes": ["bloodSugar", "weight"],
  "availableWidgets": {
    "bloodSugar": ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "weeklyAverage", "medAdherence", "medComparison", "loggingStreak", "recentAlerts", "periodComparison"],
    "weight": ["summary", "trend", "forecast", "goalProgress"]
  },
  "defaultWidgets": {
    "bloodSugar": ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"],
    "weight": ["summary", "trend", "forecast"]
  },
  "widgets": {
    "bloodSugar": {
      "summary": { "status": "ok", "data": { "avg": 126, "min": 90, "max": 200, "count": 42 } },
      "trend": { "status": "ok", "data": [{ "datetime": "2026-04-05T03:00:00.000Z", "value": 110 }] }
    },
    "weight": {
      "summary": { "status": "ok", "data": { "currentValue": 150.2, "lowestValue": 149.8, "highestValue": 151 } },
      "forecast": { "status": "ok", "data": { "status": "on_track", "cards": {}, "series": {} } }
    }
  }
}
```

Every widget result uses `{ "status": "ok" | "insufficient_data", "message"?: string, "data": ... }`.

#### `GET /health/dashboard/preferences`

ดึง account-level dashboard widget preference ของ user ปัจจุบัน แบบแยกตาม health data type

**Headers:** `Authorization: Bearer <token>`

**Permission:** `dashboard.read.self`

**Response** `200 OK`

```json
{
  "widgets": {
    "bloodSugar": ["summary", "trend", "timeInRange"],
    "weight": ["summary", "trend", "forecast"]
  }
}
```

#### `PUT /health/dashboard/preferences`

บันทึก account-level dashboard widget preference ของ user ปัจจุบัน แบบแยกตาม health data type

**Headers:** `Authorization: Bearer <token>`

**Permission:** `dashboard.update.self`

**Body**

```json
{
  "widgets": {
    "bloodSugar": ["summary", "trend", "timeInRange"],
    "weight": ["summary", "forecast", "goalProgress"]
  }
}
```

`widgets` สามารถส่งบาง data type ได้ ระบบจะ preserve preference ของ data type ที่ไม่ส่งมา และ normalize ให้ `summary` อยู่ลำดับแรกเสมอ

#### `GET /health/export`

Canonical Health Report export endpoint. FE selects report sections with `dataTypes`; the same report structure is used for single-metric and multi-metric exports.

**Headers:** `Authorization: Bearer <token>`

**Permissions:** `export.read.self`; additionally `weights.read.self` when `dataTypes` includes `weight`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | ✅ | `excel`, `pdf` |
| `dataTypes` | `string` | ❌ | comma-separated; default `bloodSugar` |

**Filenames:**
- `bloodSugar` only: `blood-sugar-report-{yyyyMMdd}.xlsx` / `blood-sugar-report-{yyyyMMdd}.pdf`
- `weight` only: `weight-report-{yyyyMMdd}.xlsx` / `weight-report-{yyyyMMdd}.pdf`
- multiple metrics: `health-report-{yyyyMMdd}.xlsx` / `health-report-{yyyyMMdd}.pdf`

`yyyyMMdd` uses `Asia/Bangkok` date. `Generated At` displays `DD Mon YYYY HH:mm ICT`.

**Report Metadata:** every PDF and Excel export includes `Report Type`, `Metrics Included`, `Patient Name`, `Period Start`, `Period End`, `Generated At`, and `Time Zone`. The period is derived from exported data. If a selected metric has no rows, its period is `-`.

`Content-Disposition` is exposed through CORS so browser clients can read the backend-generated filename.

**Excel Structure:**

| Export | Sheets |
|---|---|
| Single metric | `Summary`, `{Metric} Data` เช่น `Blood Sugar Data`, `Weight Data` |
| Multiple metrics | `Overview`, then one sheet per metric in request order เช่น `Weight`, `Blood Sugar` |

`Overview` contains report metadata and executive summary columns: `Metric`, `Latest Value`, `Status`.

**PDF Structure:**

| Export | Layout |
|---|---|
| Single metric | Standard header, metadata, metric summary, detail table |
| Multiple metrics | Cover page with metadata, executive summary, then one separate section per metric in request order |

**Metric Sections:**

| Metric | Summary | Detail Columns |
|---|---|---|
| Weight | Current Weight, Change, Goal Weight, Progress | Date, Weight, 7-Day Average, Forecast, Delta |
| Blood Sugar | Latest Reading, Average Reading, Highest Reading, Lowest Reading | Date, Time, Reading, Status |

Compatibility endpoints `/export`, `/health/blood-sugar/export`, `/health/weight/export`, and `/health-progress/export/weight` return the same standardized report layout and filename rules.

#### Blood Sugar Canonical Endpoints

| Endpoint | Description |
|---|---|
| `GET /health/blood-sugar/entries` | Alias-compatible list of blood sugar records |
| `POST /health/blood-sugar/entries` | Create blood sugar record |
| `PUT /health/blood-sugar/entries/:id` | Update blood sugar record |
| `DELETE /health/blood-sugar/entries/:id` | Delete blood sugar record |
| `GET /health/blood-sugar/dashboard?range=7d\|30d\|all` | Blood-sugar dashboard data |
| `GET /health/blood-sugar/export?type=excel\|pdf` | Blood-sugar export |

#### Weight Canonical Endpoints

| Endpoint | Description |
|---|---|
| `PUT /health/weight/entries/:date` | Upsert daily weight entry |
| `GET /health/weight/entries` | List weight entries |
| `DELETE /health/weight/entries/:date` | Delete weight entry |
| `GET /health/weight/goal` | Get active weight goal |
| `PUT /health/weight/goal` | Create/replace active weight goal |
| `GET /health/weight/forecast?range=7d\|30d\|all` | Forecast vs Actual |
| `GET /health/weight/dashboard?range=7d\|30d\|all` | Weight dashboard data |
| `GET /health/weight/export?type=excel\|pdf` | Weight progress export |

Successful weight entry upserts also sync `Profile.weight` to the value of the user's latest dated `weight_kg` entry. Backdated edits do not replace the profile weight when a newer weight entry already exists.

### 6.1 Health Progress Forecast (Deprecated Alias)

Progress Forecast เป็น feature หลักสำหรับเทียบ **Forecast vs Actual** ของ health metric โดย MVP รองรับ metric แรกคือ `weight_kg`

> Deprecated: use `/health/weight/*` canonical endpoints for new FE work.

> `Profile.weight` ยังใช้สำหรับ BMI/export เดิมเท่านั้น ไม่ใช่ source ของ forecast calculations

#### `PUT /health-progress/metrics/weight/:date`

เพิ่มหรือแก้ไขน้ำหนักรายวัน 1 ค่า ต่อ 1 calendar date

เมื่อบันทึกสำเร็จ ระบบจะ sync `Profile.weight` เป็นค่าน้ำหนักของ `weight_kg` entry วันที่ล่าสุดของ user เสมอ ถ้าแก้ข้อมูลย้อนหลังและมี entry วันที่ใหม่กว่าอยู่แล้ว profile จะยังใช้ค่าน้ำหนักจากวันที่ใหม่กว่า

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.update.self`

**Path Params:**

| Param | Type | Required | Validation |
|---|---|---|---|
| `date` | `string` | ✅ | `YYYY-MM-DD` |

**Request Body**

```json
{
  "value": 150.2
}
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "metricType": "weight_kg",
  "date": "2026-06-02",
  "value": 150.2,
  "createdAt": "2026-06-02T00:00:00.000Z",
  "updatedAt": "2026-06-02T00:00:00.000Z"
}
```

#### `GET /health-progress/metrics/weight`

ดึง raw weight inputs สำหรับหน้า edit/history

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.read.self`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | `string` | ❌ | - | `YYYY-MM-DD` |
| `to` | `string` | ❌ | - | `YYYY-MM-DD` |
| `cursor` | `string` | ❌ | - | pagination cursor |
| `limit` | `number` | ❌ | `20` | 1-100 |

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "metricType": "weight_kg",
      "date": "2026-06-02",
      "value": 150.2,
      "createdAt": "2026-06-02T00:00:00.000Z",
      "updatedAt": "2026-06-02T00:00:00.000Z"
    }
  ],
  "nextCursor": null,
  "totalCount": 1
}
```

#### `DELETE /health-progress/metrics/weight/:date`

ลบ weight input ของวันที่ระบุ

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.delete.self`

**Response** `204 No Content`

#### `GET /health-progress/goals/weight`

ดึง active weight goal ปัจจุบันของ user หรือ `null`

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.read.self`

**Response** `200 OK`

```json
{
  "id": "uuid",
  "metricType": "weight_kg",
  "startDate": "2026-06-02",
  "targetDate": "2026-12-31",
  "startValue": 150,
  "targetValue": 130,
  "createdAt": "2026-06-02T00:00:00.000Z",
  "updatedAt": "2026-06-02T00:00:00.000Z"
}
```

#### `PUT /health-progress/goals/weight`

สร้างหรือแทนที่ active weight goal ของ user

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.update.self`

**Request Body**

```json
{
  "startValue": 150,
  "targetValue": 130,
  "startDate": "2026-06-02",
  "targetDate": "2026-12-31"
}
```

**Validation:**
- `targetDate` ต้องอยู่หลัง `startDate`
- `targetValue` ต้องไม่เท่ากับ `startValue`
- ทุก date ใช้ format `YYYY-MM-DD`

**Response** `200 OK`

```json
{
  "id": "uuid",
  "metricType": "weight_kg",
  "startDate": "2026-06-02",
  "targetDate": "2026-12-31",
  "startValue": 150,
  "targetValue": 130,
  "createdAt": "2026-06-02T00:00:00.000Z",
  "updatedAt": "2026-06-02T00:00:00.000Z"
}
```

#### `GET /health-progress/forecast/weight`

Main dashboard endpoint สำหรับ Forecast vs Actual

**Headers:** `Authorization: Bearer <token>`

**Permission:** `weights.read.self`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `range` | `string` | ❌ | `30d` | `7d`, `30d`, `all` |

**Status Rules:**
- `ahead` — actual ดีกว่า forecast อย่างน้อย `0.5 kg`
- `on_track` — actual อยู่ในช่วง `±0.5 kg` จาก forecast
- `behind` — actual แย่กว่า forecast มากกว่า `0.5 kg`
- `insufficient_data` — ยังไม่มี goal หรือยังไม่มี actual entry

**Response** `200 OK`

```json
{
  "range": "30d",
  "metricType": "weight_kg",
  "status": "on_track",
  "goal": {
    "id": "uuid",
    "metricType": "weight_kg",
    "startDate": "2026-06-02",
    "targetDate": "2026-12-31",
    "startValue": 150,
    "targetValue": 130,
    "createdAt": "2026-06-02T00:00:00.000Z",
    "updatedAt": "2026-06-02T00:00:00.000Z"
  },
  "cards": {
    "currentValue": 150.2,
    "lowestValue": 149.8,
    "highestValue": 151,
    "totalChange": -0.8,
    "trendKgPerWeek": -0.7,
    "eta": {
      "status": "ok",
      "daysRemaining": 210,
      "weeksRemaining": 30,
      "estimatedDate": "2027-01-15"
    },
    "targetProgress": {
      "percent": 4,
      "remainingValue": -19.2
    },
    "forecastComparison": {
      "date": "2026-06-10",
      "forecastValue": 149.3,
      "delta": 0.9
    }
  },
  "series": {
    "actual": [
      { "date": "2026-06-02", "value": 150.2 }
    ],
    "rollingAverage": [
      { "date": "2026-06-02", "value": 150.2 }
    ],
    "forecast": [
      { "date": "2026-06-02", "value": 150 },
      { "date": "2026-12-31", "value": 130 }
    ]
  }
}
```

**Insufficient Data Response**

```json
{
  "range": "30d",
  "metricType": "weight_kg",
  "status": "insufficient_data",
  "message": "Weight goal is required to calculate forecast",
  "goal": null,
  "cards": null,
  "series": {
    "actual": [],
    "rollingAverage": [],
    "forecast": []
  }
}
```

#### `GET /health-progress/export/weight`

Compatibility endpoint for Weight Health Report export. New FE work should use `GET /health/export?dataTypes=weight`.

**Headers:** `Authorization: Bearer <token>`

**Permissions:** ต้องมีทั้ง `export.read.self` และ `weights.read.self`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | ✅ | `excel`, `pdf` |

**Data Rules:**
- export weight entries ของ user ปัจจุบัน เฉพาะ `metricType = "weight_kg"`
- เรียงตาม date ASC
- จำกัดสูงสุด 1,000 entries
- ถ้าไม่มี goal จะยัง export raw weight log ได้ แต่ forecast fields เป็น `insufficient_data`
- ถ้าไม่มี entries จะยังได้ report ที่ valid พร้อมข้อความ `No weight entries found.`

**Response (Excel)** `200 OK`

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="weight-report-20260612.xlsx"
```

Body: binary Excel file — มี 2 sheets:

**Sheet 1: Summary**

| Row | Description |
|---|---|
| Report Type | `Weight Progress Report` |
| Metrics Included | `Weight` |
| Patient Name | ชื่อผู้ใช้ |
| Period Start / Period End | derived จาก weight entries |
| Generated At | เวลา export ใน `ICT` |
| Time Zone | `Asia/Bangkok` |
| Current Weight / Change / Goal Weight / Progress | สรุป weight report |

**Sheet 2: Weight Data**

| Column | Description |
|---|---|
| Date | วันที่ |
| Weight | น้ำหนักที่บันทึก |
| 7-Day Average | rolling average จาก entries ที่มี |
| Forecast | forecast value ของวันนั้น ถ้ามี goal |
| Delta | actual - forecast ถ้ามี goal |

**Response (PDF)** `200 OK`

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="weight-report-20260612.pdf"
```

Body: binary PDF file (A4 portrait) — มี standard report header, metadata, summary และ detail table

---

### 7. Export

#### `GET /export`

Compatibility endpoint for Blood Sugar Health Report export. New FE work should use `GET /health/export?dataTypes=bloodSugar`.

รายงานประกอบด้วย:
- **Metadata** — Report Type, Metrics Included, Patient Name, Period Start/End, Generated At, Time Zone
- **Summary** — Latest Reading, Average Reading, Highest Reading, Lowest Reading
- **Detail Table** — Date, Time, Reading, Status

**Blood Sugar Classification:**

| Status | Range | Color |
|---|---|---|
| Not measured | 0 | Gray |
| Low | < 70 mg/dL | 🟠 Orange |
| Normal | 70–180 mg/dL | 🟢 Green |
| High | > 180 mg/dL | 🔴 Red |

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**

| Param | Type | Required | Options |
|---|---|---|---|
| `type` | `string` | ✅ | `excel`, `pdf` |

**Response (Excel)** `200 OK`

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="blood-sugar-report-20260612.xlsx"
```

Body: binary Excel file — มี 2 sheets:

**Sheet 1: Summary**

| Row | Description |
|---|---|
| Report Type | `Blood Sugar Report` |
| Metrics Included | `Blood Sugar` |
| Patient Name | ชื่อผู้ป่วย |
| Period Start / Period End | derived จาก records |
| Generated At | เวลา export ใน `ICT` |
| Time Zone | `Asia/Bangkok` |
| Latest / Average / Highest / Lowest Reading | สรุปค่าน้ำตาลจาก measured records (`bloodSugar > 0`) |

**Sheet 2: Blood Sugar Data**

| Column | Description |
|---|---|
| Date | วันที่ |
| Time | เวลา |
| Reading | ค่าน้ำตาลในเลือด |
| Status | Not measured / Low / Normal / High (color-coded) |

> Excel มี auto-filter, freeze header row, alternate row shading, cell borders

**Response (PDF)** `200 OK`

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="blood-sugar-report-20260612.pdf"
```

Body: binary PDF file (A4 portrait) — มี standard report header, metadata, summary และ detail table

---

### 8. Shared Links

#### `POST /shared-links`

สร้าง public link สำหรับแชร์ข้อมูลสุขภาพที่เลือกให้แพทย์ดูโดยไม่ต้อง login

**Headers:** `Authorization: Bearer <token>`

**Rules:**
- ช่วงข้อมูลที่แชร์ได้สูงสุด 90 วัน
- อายุลิงก์เลือกได้ `1`, `3`, `7`, `30` วัน
- ถ้าช่วงที่เลือกมี records/entries รวมกันเกิน 1,000 รายการ จะไม่สร้างลิงก์และตอบ `400`
- `dataTypes` รองรับ `bloodSugar`, `weight`; ถ้าไม่ส่งจะ default เป็น `["bloodSugar"]`
- backend เก็บ token hash สำหรับ public lookup และเก็บ public token เพื่อให้ history สร้าง `publicPath` ได้

**Request**

```json
{
  "startDate": "2026-05-01T00:00:00.000Z",
  "endDate": "2026-05-31T23:59:59.999Z",
  "expiresInDays": 7,
  "dataTypes": ["bloodSugar", "weight"]
}
```

**Response** `201 Created`

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "publicPath": "/shared/abc123",
  "token": "abc123",
  "dataStartAt": "2026-05-01T00:00:00.000Z",
  "dataEndAt": "2026-05-31T23:59:59.999Z",
  "dataTypes": ["bloodSugar", "weight"],
  "expiresAt": "2026-06-07T00:00:00.000Z",
  "revokedAt": null,
  "status": "active",
  "createdAt": "2026-05-08T00:00:00.000Z"
}
```

#### `GET /shared-links`

ดูลิงก์ทั้งหมดที่ user สร้างไว้ เรียงจากใหม่ไปเก่า

**Headers:** `Authorization: Bearer <token>`

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "publicPath": "/shared/abc123",
      "dataStartAt": "2026-05-01T00:00:00.000Z",
      "dataEndAt": "2026-05-31T23:59:59.999Z",
      "dataTypes": ["bloodSugar"],
      "expiresAt": "2026-06-07T00:00:00.000Z",
      "revokedAt": null,
      "status": "active",
      "createdAt": "2026-05-08T00:00:00.000Z"
    }
  ]
}
```

> `status` เป็น `active`, `expired`, หรือ `revoked`; `publicPath` จะเป็น path เฉพาะ active link ที่มี public token อยู่ และเป็น `null` สำหรับ expired/revoked/legacy links; endpoint นี้ไม่คืน raw token field

#### `POST /shared-links/:id/revoke`

ยกเลิกลิงก์ก่อนหมดอายุ เฉพาะ owner ของลิงก์เท่านั้น

**Headers:** `Authorization: Bearer <token>`

**Response** `200 OK`

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "dataStartAt": "2026-05-01T00:00:00.000Z",
  "dataEndAt": "2026-05-31T23:59:59.999Z",
  "dataTypes": ["bloodSugar"],
  "expiresAt": "2026-06-07T00:00:00.000Z",
  "revokedAt": "2026-05-08T12:00:00.000Z",
  "status": "revoked",
  "createdAt": "2026-05-08T00:00:00.000Z"
}
```

#### `GET /public/shared-links/:token`

Public endpoint สำหรับหน้า `/shared/{token}` ไม่ต้อง login

**Response** `200 OK`

```json
{
  "patient": {
    "name": "Tester",
    "email": "tester@example.com",
    "weight": 70,
    "height": 170
  },
  "sharedLink": {
    "dataStartAt": "2026-05-01T00:00:00.000Z",
    "dataEndAt": "2026-05-31T23:59:59.999Z",
    "expiresAt": "2026-06-07T00:00:00.000Z",
    "status": "active",
    "dataTypes": ["bloodSugar", "weight"]
  },
  "data": {
    "bloodSugar": {
      "records": [
        {
          "datetime": "2026-05-02T10:00:00.000Z",
          "bloodSugar": 120,
          "medMorning": 1,
          "medEvening": null,
          "note": "before breakfast"
        }
      ],
      "summary": { "status": "ok", "data": {} }
    },
    "weight": {
      "entries": [
        { "date": "2026-05-02", "value": 150.2 }
      ],
      "goal": null,
      "forecastSummary": { "status": "insufficient_data" }
    }
  },
  "records": [
    {
      "datetime": "2026-05-02T10:00:00.000Z",
      "bloodSugar": 120,
      "medMorning": 1,
      "medEvening": null,
      "note": "before breakfast"
    }
  ],
  "meta": {
    "totalCount": 1,
    "returnedCount": 1,
    "limit": 1000
  }
}
```

> `records` top-level เป็น legacy compatibility สำหรับ blood-sugar links; FE ใหม่ควรอ่านจาก `data.bloodSugar.records`

**Errors:**
- `404` ถ้า token ไม่พบ, หมดอายุ, หรือถูก revoke

---

### 9. Backoffice RBAC

ทุก endpoint ในหมวดนี้ต้อง authentication และต้องมี permission ที่ระบุไว้ ถ้าไม่มีสิทธิ์จะได้ `403 Permission denied`.

#### `GET /backoffice/permissions`

ดึง fixed permission catalog สำหรับหน้า role management

**Required permission:** `roles.read.system`

**Response** `200 OK`

```json
{
  "data": [
    {
      "code": "records.read.self",
      "category": "records",
      "categoryLabel": "Records",
      "action": "read",
      "scope": "self",
      "label": "View own records"
    },
    {
      "code": "weights.read.self",
      "category": "weights",
      "categoryLabel": "Weight Tracking",
      "action": "read",
      "scope": "self",
      "label": "View own weight entries"
    }
  ]
}
```

#### `GET /backoffice/roles`

ดึง role ทั้งหมดพร้อม permissions

**Required permission:** `roles.read.system`

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Admin",
      "description": "System administrator",
      "isSystem": true,
      "isActive": true,
      "permissions": [
        {
          "id": "uuid",
          "code": "roles.update.system",
          "category": "roles",
          "categoryLabel": "Roles",
          "action": "update",
          "scope": "system",
          "label": "Update roles"
        }
      ],
      "createdAt": "2026-06-02T00:00:00.000Z",
      "updatedAt": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

#### `POST /backoffice/roles`

สร้าง role ใหม่และเลือก permission ให้ role

**Required permission:** `roles.create.system`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | `string` | ✅ | min 1, max 100 |
| `description` | `string \| null` | ❌ | max 500 |
| `isActive` | `boolean` | ❌ | default `true` |
| `permissions` | `string[]` | ❌ | ต้องเป็น permission code ที่มีใน catalog |

**Request Body Example:**

```json
{
  "name": "Care Team",
  "description": "Can view patient records",
  "isActive": true,
  "permissions": ["records.read.any", "profile.read.any"]
}
```

**Response** `201 Created`

คืน role object รูปแบบเดียวกับ `GET /backoffice/roles/:id`

#### `GET /backoffice/roles/:id`

ดู role รายตัว

**Required permission:** `roles.read.system`

**Response** `200 OK`

คืน role object พร้อม permissions

#### `PUT /backoffice/roles/:id`

แก้ไข role และ permission ของ role

**Required permission:** `roles.update.system`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | `string` | ❌ | min 1, max 100 |
| `description` | `string \| null` | ❌ | max 500 |
| `isActive` | `boolean` | ❌ | system `Admin` ห้าม deactivate |
| `permissions` | `string[]` | ❌ | replace permission ทั้งชุดของ role |

**Rules:**
- system role เปลี่ยนชื่อไม่ได้
- `Admin` role ต้องคง `roles.update.system` และ `users.assignRoles.system`

#### `DELETE /backoffice/roles/:id`

ลบ role

**Required permission:** `roles.delete.system`

**Response** `204 No Content`

**Rules:**
- system roles เช่น `Admin`, `User` ลบไม่ได้

#### `GET /backoffice/users`

ดึง users สำหรับหน้า user management

**Required permission:** `users.read.system`

**Query Params:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `q` | `string` | ❌ | search email/name, min 1, max 100 |
| `limit` | `number` | ❌ | min 1, max 100, default 50 |

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "สมชาย",
      "profile": {
        "id": "uuid",
        "userId": "uuid",
        "weight": 70,
        "height": 170,
        "createdAt": "2026-06-02T00:00:00.000Z"
      },
      "roles": [],
      "permissions": [],
      "createdAt": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

#### `GET /backoffice/users/:id`

ดู user รายตัวพร้อม profile, roles, permissions

**Required permission:** `users.read.system`

**Response** `200 OK`

คืน user object รูปแบบเดียวกับ `GET /backoffice/users`

#### `PUT /backoffice/users/:id/profile`

แก้ profile/email/name ของ user อื่นจาก backoffice

**Required permission:** `users.update.system`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `firstName` | `string` | ❌ | min 1, max 100 |
| `lastName` | `string` | ❌ | min 1, max 100 |
| `email` | `string` | ❌ | valid email |
| `weight` | `number \| null` | ❌ | positive |
| `height` | `number \| null` | ❌ | positive |

ถ้าแก้ `firstName`, `lastName`, หรือ `email` backend จะอัปเดต identity ใน App DB โดยตรง

#### `PUT /backoffice/users/:id/roles`

replace roles ของ user

**Required permission:** `users.assignRoles.system`

**Request Body:**

```json
{
  "roleIds": ["uuid"]
}
```

**Rules:**
- `roleIds` ทุกตัวต้องมีอยู่จริง
- ห้าม remove `Admin` role จาก admin คนสุดท้าย

---

### 10. Backup Center

Backup Center ใช้สำหรับสร้าง database backup และดูประวัติ backup logs. Backend ใช้ route style เดิมของ repo ไม่มี `/api/v1`.

#### `POST /internal/backup/run`

ให้ cron-job.org เรียกเพื่อเริ่ม scheduled backup

**Authentication:** ไม่ใช้ Bearer token แต่ต้องส่ง header:

```http
x-backup-secret: <BACKUP_CRON_SECRET>
```

**Behavior:**
- ถ้า secret ไม่ถูกต้อง return `401` และไม่สร้าง backup log
- ถ้ามี backup log `status = "running"` อยู่แล้ว จะไม่เริ่ม backup ใหม่
- เมื่อเริ่ม backup แล้ว ระบบจะสร้าง log `running`, สร้างไฟล์ backup, upload zip เข้า Supabase Storage, แล้ว update log เป็น `success` หรือ `failed`
- Response ไม่ expose temp file path หรือ stack trace

**Success Response** `200 OK`

```json
{
  "message": "Backup completed successfully",
  "backupId": "backup_001",
  "fileName": "backup_2026-06-04_0200.zip",
  "status": "success"
}
```

**Already Running Response** `200 OK`

```json
{
  "message": "Backup is already running",
  "status": "running"
}
```

**Failed Response** `500 Internal Server Error`

```json
{
  "message": "Backup failed",
  "backupId": "backup_001",
  "status": "failed",
  "error": "pg_dump failed"
}
```

#### `POST /backoffice/backups/run`

ให้ admin กดสร้าง manual backup จาก backoffice

**Required permission:** `backups.create.system`

**Behavior:**
- ต้อง authentication
- ใช้ flow เดียวกับ scheduled backup
- ตั้ง `triggerType = "manual"`
- บันทึก `createdBy = request.user.id`

**Success Response** `200 OK`

```json
{
  "message": "Manual backup completed successfully",
  "backupId": "backup_002",
  "fileName": "backup_2026-06-04_1430.zip",
  "status": "success"
}
```

#### `GET /backoffice/backups`

ดึง backup logs สำหรับหน้า Backup Center

**Required permission:** `backups.read.system`

**Query Params:**

| Field | Type | Required | Validation |
|---|---|---:|---|
| `page` | `number` | ❌ | min 1, default 1 |
| `limit` | `number` | ❌ | min 1, max 100, default 20 |
| `status` | `pending \| running \| success \| failed` | ❌ | filter status |
| `triggerType` | `scheduled \| manual` | ❌ | filter trigger type |

**Scroll Fetch Contract:**
- FE ใช้ `page` และ `limit` เพื่อโหลดเพิ่มแบบ infinite scroll
- โหลดหน้าถัดไปเมื่อ `items.length === limit` และ `page * limit < total`
- Response มี `total` เพื่อให้ FE รู้ว่ายังมีข้อมูลเหลือหรือไม่

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": "backup_001",
      "status": "success",
      "triggerType": "scheduled",
      "fileName": "backup_2026-06-04_0200.zip",
      "fileSize": 1240000,
      "storageObjectPath": "backups/production/2026/06/backup_001.zip",
      "startedAt": "2026-06-04T02:00:00.000Z",
      "finishedAt": "2026-06-04T02:00:15.000Z",
      "errorMessage": null,
      "createdBy": null,
      "createdAt": "2026-06-04T02:00:00.000Z",
      "updatedAt": "2026-06-04T02:00:15.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

#### Backup File Contract

ไฟล์ backup เป็น private `.zip` เท่านั้น และไม่สร้าง public share link โดย default. Backend upload เข้า Supabase Storage ด้วย service role key และบันทึก object path ลง backup log.

```text
backup_2026-06-04_0200.zip
├── database.sql
├── database.xlsx
└── manifest.json
```

`manifest.json` example:

```json
{
  "backupAt": "2026-06-04T02:00:00.000Z",
  "environment": "production",
  "type": "scheduled",
  "databaseProvider": "postgresql",
  "files": [
    { "name": "database.sql", "type": "sql_dump" },
    { "name": "database.xlsx", "type": "excel_export" }
  ],
  "status": "success"
}
```

**Excel Export Rules:**
- 1 table/module ต่อ 1 sheet
- ใช้ column whitelist เท่านั้น
- Sheet ที่ไม่มีข้อมูลยังมี header และไม่ throw error
- ห้าม export sensitive fields เช่น `password`, `passwordHash`, `access_token`, `refresh_token`, `reset_password_token`, `otp`, `otpHash`, `session_token`, `secret_key`, `private_key`, `tokenHash`, `publicToken`, `verification_token`
- SQL dump เป็น restore artifact จึงอาจมีข้อมูลครบตามฐานข้อมูลจริง

---

## Data Models (Prisma)

### User

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `email` | `String` | Email สำหรับ local login (unique) |
| `name` | `String?` | ชื่อผู้ใช้ |
| `passwordHash` | `String?` | Local password hash |
| `passwordChangeRequired` | `Boolean` | บังคับเปลี่ยนรหัสผ่านหลัง login |
| `passwordChangedAt` | `DateTime?` | เวลาที่เปลี่ยนรหัสผ่านล่าสุด |
| `migratedFrom` | `String?` | แหล่ง migration/import |
| `migratedAt` | `DateTime?` | เวลาที่ migrate user |
| `temporaryPasswordSentAt` | `DateTime?` | เวลาที่ส่ง temporary password ล่าสุด |
| `createdAt` | `DateTime` | วันที่สร้าง |

### Profile

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `userId` | `String` | FK → User (unique, cascade delete) |
| `weight` | `Float?` | น้ำหนัก (kg) |
| `height` | `Float?` | ส่วนสูง (cm) |
| `createdAt` | `DateTime` | วันที่สร้าง |

### Record

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `userId` | `String` | FK → User (cascade delete) |
| `datetime` | `DateTime` | วันเวลาที่บันทึก |
| `bloodSugar` | `Int` | ค่าน้ำตาลในเลือด (`0` = ไม่ได้เจาะตรวจ, หรือ `20-600`) |
| `medMorning` | `Int?` | จำนวนยาเช้า |
| `medEvening` | `Int?` | จำนวนยาเย็น |
| `note` | `String?` | หมายเหตุ (max 1000) |
| `createdAt` | `DateTime` | วันที่สร้าง |

> Index: `(userId, datetime)` บน Record table

### HealthMetricEntry

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `userId` | `String` | FK → User (cascade delete) |
| `metricType` | `String` | health metric key, MVP ใช้ `weight_kg` |
| `date` | `DateTime` | calendar date ที่บันทึกแบบ date-only UTC |
| `value` | `Float` | metric value |
| `createdAt` | `DateTime` | วันที่สร้าง |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

> Unique: `(userId, metricType, date)`, Index: `(userId, metricType, date)`

### HealthGoal

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `userId` | `String` | FK → User (cascade delete) |
| `metricType` | `String` | health metric key, MVP ใช้ `weight_kg` |
| `startDate` | `DateTime` | วันที่เริ่ม forecast plan |
| `targetDate` | `DateTime` | วันที่เป้าหมาย |
| `startValue` | `Float` | ค่าเริ่มต้นของ goal |
| `targetValue` | `Float` | ค่าเป้าหมาย |
| `createdAt` | `DateTime` | วันที่สร้าง |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

> Unique: `(userId, metricType)`, Index: `(userId, metricType)`

### PasswordResetOtp

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `email` | `String` | Email ที่ขอ reset |
| `otpHash` | `String` | HMAC-SHA256 hash ของ OTP |
| `expiresAt` | `DateTime` | วันหมดอายุ (10 นาที) |
| `attempts` | `Int` | จำนวนครั้งที่ลองผิด (max 5) |
| `consumedAt` | `DateTime?` | วันที่ใช้ OTP สำเร็จ |
| `createdAt` | `DateTime` | วันที่สร้าง |

> Index: `(email)`, `(expiresAt)` บน PasswordResetOtp table

### SharedLink

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `userId` | `String` | FK → User (cascade delete) |
| `tokenHash` | `String` | SHA-256 hash ของ public token (unique) |
| `publicToken` | `String?` | raw opaque token สำหรับสร้าง `publicPath` ใน history (unique, nullable สำหรับ legacy rows) |
| `dataStartAt` | `DateTime` | เวลาเริ่มต้นของ records ที่แชร์ |
| `dataEndAt` | `DateTime` | เวลาสิ้นสุดของ records ที่แชร์ |
| `dataTypes` | `Json` | selected health data types, default `["bloodSugar"]` |
| `expiresAt` | `DateTime` | วันหมดอายุของลิงก์ |
| `revokedAt` | `DateTime?` | เวลาที่ยกเลิกลิงก์ก่อนหมดอายุ |
| `createdAt` | `DateTime` | วันที่สร้าง |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

> Index: unique `(tokenHash)`, unique `(publicToken)`, `(userId, createdAt)`, `(expiresAt)` บน SharedLink table

### BackupLog

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `status` | `String` | `pending`, `running`, `success`, หรือ `failed` |
| `triggerType` | `String` | `scheduled` หรือ `manual` |
| `fileName` | `String?` | ชื่อ zip file ที่สร้าง |
| `fileSize` | `Int?` | ขนาด zip file เป็น bytes |
| `storageObjectPath` | `String?` | path/object key หลัง storage uploader ทำงานสำเร็จ; map กับ column เดิมเพื่อ compatibility |
| `startedAt` | `DateTime` | เวลาที่เริ่ม backup |
| `finishedAt` | `DateTime?` | เวลาที่ backup สำเร็จหรือล้มเหลว |
| `errorMessage` | `String?` | short sanitized error message กรณี failed |
| `createdBy` | `String?` | FK → User สำหรับ manual backup (set null เมื่อ user ถูกลบ) |
| `createdAt` | `DateTime` | วันที่สร้าง log |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

> Index: `(status)`, `(triggerType)`, `(startedAt)`, `(createdBy)` บน BackupLog table

### Role

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `name` | `String` | ชื่อ role (unique) |
| `description` | `String?` | คำอธิบาย role |
| `isSystem` | `Boolean` | system role เช่น `Admin`, `User` |
| `isActive` | `Boolean` | inactive role จะไม่ให้ permission |
| `createdAt` | `DateTime` | วันที่สร้าง |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

### Permission

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `code` | `String` | permission code จาก fixed catalog เช่น `records.read.self` (unique) |
| `category` | `String` | กลุ่ม feature เช่น `records`, `weights` |
| `categoryLabel` | `String` | label สำหรับแสดงใน backoffice |
| `action` | `String` | action เช่น `read`, `create`, `update`, `delete` |
| `scope` | `String` | scope เช่น `self`, `any`, `system` |
| `label` | `String` | คำอธิบาย permission |
| `createdAt` | `DateTime` | วันที่สร้าง |
| `updatedAt` | `DateTime` | วันที่แก้ไขล่าสุด |

> Index: unique `(code)`, `(category)` บน Permission table

### RolePermission

| Field | Type | Description |
|---|---|---|
| `roleId` | `String` | FK → Role (cascade delete) |
| `permissionId` | `String` | FK → Permission (cascade delete) |
| `createdAt` | `DateTime` | วันที่ assign permission |

> Primary key: `(roleId, permissionId)`

### UserRole

| Field | Type | Description |
|---|---|---|
| `userId` | `String` | FK → User (cascade delete) |
| `roleId` | `String` | FK → Role (cascade delete) |
| `createdAt` | `DateTime` | วันที่ assign role |

> Primary key: `(userId, roleId)`
