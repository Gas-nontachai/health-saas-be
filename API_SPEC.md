# Health SaaS Backend — API Specification

Base URL: `http://localhost:3000`

## Authentication

Backend มี auth endpoints ให้ FE เรียกโดยตรง — ภายในจะ proxy ไปยัง **Keycloak** ให้อัตโนมัติ

ทุก endpoint (ยกเว้น `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/password/forgot/*`) ต้องส่ง **Bearer token** ผ่าน header:

```
Authorization: Bearer <access_token>
```

- Backend verify token ผ่าน Keycloak JWKS endpoint โดยอัตโนมัติ
- เมื่อ token ถูกต้อง ระบบจะ **upsert user** ในฐานข้อมูลจาก token payload (`sub`, `email`, `name`)
- ครั้งแรกที่ยิง API ด้วย token ใหม่ ระบบจะสร้าง user + profile ให้เอง
- หาก token ไม่ถูกต้อง/หมดอายุ จะได้ response `401`

### FE Integration Flow (สรุป)

```
┌─────────┐                              ┌─────────────┐         ┌──────────┐
│   FE    │── POST /auth/register ──────▶│   Backend   │──proxy─▶│ Keycloak │
│  (SPA)  │── POST /auth/login ────────▶│   :3000     │──proxy─▶│          │
│         │◀── token response ───────────│             │◀────────│          │
│         │                              │             │         └──────────┘
│         │── Bearer token ────────────▶│             │
│         │◀── JSON data ───────────────│             │
└─────────┘                              └─────────────┘

1. FE เรียก POST /auth/register หรือ POST /auth/login
2. Backend สร้าง user ใน Keycloak แล้วส่ง token กลับ
3. FE เก็บ access_token + refresh_token
4. FE ยิง API อื่นๆ ด้วย Authorization: Bearer <access_token>
5. Backend verify token → upsert user → return data
6. เมื่อ access_token หมดอายุ (5 นาที) → FE เรียก POST /auth/refresh ด้วย refresh_token
7. ได้ access_token + refresh_token ชุดใหม่ → กลับไปข้อ 4
```

---

## Rate Limiting

- **100 requests** ต่อ **1 นาที** ต่อ IP

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
| `404` | Resource not found |
| `409` | Conflict (e.g. user already exists) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Keycloak upstream error |

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

สมัครสมาชิก — สร้าง user ใน Keycloak แล้วส่ง token กลับ (ไม่ต้อง authentication)

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
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "id_token": "eyJhbGciOi...",
  "session_state": "uuid",
  "scope": "openid profile email"
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Validation error (email format, password too short) |
| `409` | User already exists |
| `502` | Keycloak upstream error |

---

#### `POST /auth/login`

เข้าสู่ระบบ — ส่ง email/password ไป Keycloak แล้วรับ token กลับ (ไม่ต้อง authentication)

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
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "id_token": "eyJhbGciOi...",
  "session_state": "uuid",
  "scope": "openid profile email"
}
```

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
  "keycloakId": "keycloak-uuid",
  "email": "user@example.com",
  "name": "สมชาย"
}
```

---

#### `POST /auth/refresh`

ต่ออายุ token ด้วย refresh_token (ไม่ต้อง authentication)

> access_token หมดอายุ **5 นาที**, refresh_token หมดอายุ **30 นาที**  
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
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "session_state": "uuid",
  "scope": "profile email"
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
  "nextCursor": "uuid-of-last-record-or-null"
}
```

> `nextCursor` จะเป็น `null` เมื่อไม่มีข้อมูลเพิ่มแล้ว

---

#### `POST /records`

สร้าง record ใหม่

**Headers:** `Authorization: Bearer <token>`

**Request Body:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `datetime` | `string` | ✅ | ISO 8601 datetime with offset (e.g. `2026-05-04T10:00:00+07:00`) |
| `bloodSugar` | `integer` | ✅ | min: 20, max: 600 |
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
| `bloodSugar` | `integer` | ❌ | min: 20, max: 600 |
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

อัปเดต profile (สร้างให้อัตโนมัติถ้ายังไม่มี) สามารถแก้ชื่อ/email ได้ (sync กับ Keycloak)

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

ดึง dashboard widgets — FE เลือกได้ว่าจะแสดง widget ไหนบ้าง ถ้าข้อมูลไม่เพียงพอ widget จะบอก status `"insufficient_data"` พร้อม message

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `range` | `string` | ❌ | `30d` | `7d`, `30d`, `all` |
| `widgets` | `string` | ❌ | default set | comma-separated widget keys เช่น `summary,trend,bmi` |

**Available Widgets:**

| Key | Description | ต้องการข้อมูลขั้นต่ำ |
|---|---|---|
| `summary` | สรุป avg / min / max / count | ≥ 1 record |
| `trend` | ข้อมูล line chart (datetime + value) | ≥ 1 record |
| `timeInRange` | % Time in Range (Low < 70, Normal 70–180, High > 180) | ≥ 1 record |
| `distribution` | Histogram buckets (\<70, 70–100, 101–140, 141–180, 181–250, >250) | ≥ 1 record |
| `dailyPattern` | ค่าเฉลี่ยตามช่วงเวลา (morning/afternoon/evening/night) | ≥ 3 records |
| `weeklyAverage` | สรุปรายสัปดาห์ (avg, min, max) | ≥ 2 records |
| `medAdherence` | % วันที่กินยาครบ (morning/evening/both) | ≥ 1 record + มี med data |
| `medComparison` | เปรียบเทียบค่าน้ำตาล วันกินยา vs ไม่กินยา | ≥ 3 records + ต้องมีทั้งสอง |
| `loggingStreak` | จำนวนวันบันทึกติดต่อกัน + longest streak | ≥ 1 record |
| `recentAlerts` | 10 records ล่าสุดที่ Low / High | ≥ 1 record |
| `bmi` | คำนวณ BMI จาก profile | ต้องมี weight + height |
| `periodComparison` | เทียบค่าเฉลี่ยช่วงปัจจุบัน vs ช่วงก่อนหน้า | range ≠ `all` + ต้องมี records ทั้ง 2 ช่วง |

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

### 6. Export

#### `GET /export`

Export records เป็นรายงานสำหรับแพทย์/พยาบาล ในรูปแบบ Excel หรือ PDF (สูงสุด 1,000 records เรียงตาม datetime ASC)

รายงานประกอบด้วย:
- **ข้อมูลผู้ป่วย** — ชื่อ, email, น้ำหนัก, ส่วนสูง
- **สรุปสถิติ** — จำนวน record, ค่าเฉลี่ย, ค่าต่ำสุด/สูงสุด, จำนวน Normal/Low/High
- **ตาราง records** — แบ่งคอลัมน์ชัดเจน พร้อม color-coded status

**Blood Sugar Classification:**

| Status | Range | Color |
|---|---|---|
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
Content-Disposition: attachment; filename="blood-sugar-records.xlsx"
```

Body: binary Excel file — มี 2 sheets:

**Sheet 1: Summary**

| Row | Description |
|---|---|
| Patient Name | ชื่อผู้ป่วย |
| Email | อีเมล |
| Weight / Height | น้ำหนัก / ส่วนสูง (ถ้ามี) |
| Export Date | วันที่ export |
| Date Range | ช่วงเวลาของ records |
| Total Records | จำนวน records ทั้งหมด |
| Average / Min / Max | ค่าเฉลี่ย, ต่ำสุด, สูงสุด (mg/dL) |
| Normal / Low / High | จำนวนและเปอร์เซ็นต์แต่ละระดับ |

**Sheet 2: Records**

| Column | Description |
|---|---|
| # | ลำดับ |
| Date | วันที่ (YYYY-MM-DD) |
| Time (UTC) | เวลา (HH:MM:SS) |
| Blood Sugar (mg/dL) | ค่าน้ำตาลในเลือด |
| Status | Low / Normal / High (color-coded) |
| Morning Med | ยาเช้า |
| Evening Med | ยาเย็น |
| Note | หมายเหตุ |

> Excel มี auto-filter, freeze header row, alternate row shading, cell borders

**Response (PDF)** `200 OK`

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="blood-sugar-records.pdf"
```

Body: binary PDF file (A4 landscape) — มี header ข้อมูลผู้ป่วย, สรุปสถิติ, ตาราง records พร้อม color-coded status, page number footer ทุกหน้า

---

## Data Models (Prisma)

### User

| Field | Type | Description |
|---|---|---|
| `id` | `String (UUID)` | Primary key |
| `keycloakId` | `String` | Keycloak subject (unique) |
| `email` | `String` | Email จาก token |
| `name` | `String?` | ชื่อจาก token |
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
| `bloodSugar` | `Int` | ค่าน้ำตาลในเลือด (20-600) |
| `medMorning` | `Int?` | จำนวนยาเช้า |
| `medEvening` | `Int?` | จำนวนยาเย็น |
| `note` | `String?` | หมายเหตุ (max 1000) |
| `createdAt` | `DateTime` | วันที่สร้าง |

> Index: `(userId, datetime)` บน Record table

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
