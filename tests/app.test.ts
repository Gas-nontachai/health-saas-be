import type { FastifyReply, FastifyRequest } from "fastify";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/index.js";
import type { AppPrisma } from "../src/infra/prisma.js";
import { PERMISSION_CODES } from "../src/modules/identity/rbac/permissions.js";
import { HttpError } from "../src/common/errors.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/blood_sugar",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-for-local-auth",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  RESET_OTP_SECRET: "test-reset-otp-secret-that-is-long-enough",
  INITIAL_ADMIN_BOOTSTRAP_ON_START: false,
  RBAC_SYNC_ON_START: false,
  BACKUP_CRON_SECRET: "test-backup-secret",
  BACKUP_TEMP_DIR: "/tmp/backups",
  BACKUP_ENVIRONMENT: "test",
  BACKUP_INCLUDE_EXCEL: true,
  BACKUP_INCLUDE_SQL: true
};

function mockAuth(userId = "user-1", permissions: string[] = [...PERMISSION_CODES]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    request.user = {
      id: userId,
      email: "tester@example.com",
      name: "Tester",
      roles: ["Admin"],
      permissions,
      passwordChangeRequired: false
    };
  };
}

function mockPrisma(overrides: Partial<AppPrisma> = {}): AppPrisma {
  const prisma = {
    record: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({
        _avg: { bloodSugar: null },
        _min: { bloodSugar: null },
        _max: { bloodSugar: null }
      })
    },
    profile: {
      upsert: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null)
    },
    userPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0)
    },
    healthMetricEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn()
    },
    healthGoal: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn()
    },
    passwordResetOtp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    sharedLink: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as AppPrisma;
  Object.defineProperty(prisma, "$transaction", {
    value: vi.fn(async (callback: (tx: AppPrisma) => Promise<unknown>) => callback(prisma))
  });
  return prisma;
}

function mockKeycloakAuth() {
  return {
    register: vi.fn(),
    login: vi.fn(),
    refreshToken: vi.fn(),
    resetPassword: vi.fn(),
    findUserByEmail: vi.fn(),
    setPassword: vi.fn(),
    updateUser: vi.fn()
  };
}

function mockLocalAuth() {
  return {
    register: vi.fn(),
    login: vi.fn(),
    refreshToken: vi.fn(),
    resetPassword: vi.fn(),
    changeRequiredPassword: vi.fn()
  };
}

function mockPasswordReset() {
  return {
    requestForgotPassword: vi.fn().mockResolvedValue({ message: "If the email exists, an OTP has been sent" }),
    confirmForgotPassword: vi.fn()
  };
}

function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  return text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function getFirstPdfMediaBox(buffer: Buffer): { width: number; height: number } {
  const text = buffer.toString("latin1");
  const mediaBox = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!mediaBox) throw new Error("PDF MediaBox not found");
  return { width: Number(mediaBox[1]), height: Number(mediaBox[2]) };
}

function mockRecord(index: number) {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    userId: "user-1",
    datetime: new Date(Date.UTC(2026, 4, 1, 10, index)),
    bloodSugar: 100 + index,
    medMorning: null,
    medEvening: null,
    note: null,
    createdAt: new Date()
  };
}

function mockSharedLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: "user-1",
    tokenHash: "a".repeat(64),
    publicToken: "abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-",
    dataStartAt: new Date("2026-05-01T00:00:00.000Z"),
    dataEndAt: new Date("2026-05-31T23:59:59.999Z"),
    expiresAt: new Date("2026-06-07T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
    ...overrides
  };
}

function mockHealthMetricEntry(date: string, value: number, index = 1) {
  return {
    id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    userId: "user-1",
    metricType: "weight_kg",
    date: new Date(`${date}T00:00:00.000Z`),
    value,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z")
  };
}

function mockHealthGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "user-1",
    metricType: "weight_kg",
    startDate: new Date("2026-06-01T00:00:00.000Z"),
    targetDate: new Date("2026-06-30T00:00:00.000Z"),
    startValue: 150,
    targetValue: 140,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides
  };
}

describe("app", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns health status", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), logger: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    await app.close();
  });

  it("syncs the RBAC catalog on app start when enabled", async () => {
    const prisma = mockPrisma();
    const syncPermissions = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp({
      config: { ...config, RBAC_SYNC_ON_START: true },
      prisma,
      authenticate: mockAuth(),
      syncPermissions,
      logger: false
    });

    expect(syncPermissions).toHaveBeenCalledWith(prisma);
    await app.close();
  });

  it("bootstraps initial admin on app start when enabled", async () => {
    const prisma = mockPrisma();
    const bootstrapInitialAdmin = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp({
      config: {
        ...config,
        INITIAL_ADMIN_EMAIL: "admin@test.com",
        INITIAL_ADMIN_PASSWORD: "admin1234",
        INITIAL_ADMIN_BOOTSTRAP_ON_START: true
      },
      prisma,
      authenticate: mockAuth(),
      bootstrapInitialAdmin,
      logger: false
    });

    expect(bootstrapInitialAdmin).toHaveBeenCalledWith(prisma);
    await app.close();
  });

  it("registers users through local auth and returns tokens", async () => {
    const localAuth = mockLocalAuth();
    localAuth.register.mockResolvedValue({
      access_token: "access-token",
      expires_in: 300,
      refresh_token: "refresh-token",
      requiresPasswordChange: false,
      user: { id: "user-1", email: "tester@example.com", name: "Tester", roles: [], permissions: [] },
      token_type: "Bearer"
    });
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), localAuth, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "Tester@Example.com",
        password: "password123",
        firstName: "Tester"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      access_token: "access-token",
      expires_in: 300,
      refresh_token: "refresh-token",
      requiresPasswordChange: false,
      user: { id: "user-1", email: "tester@example.com", name: "Tester", roles: [], permissions: [] },
      token_type: "Bearer"
    });
    expect(localAuth.register).toHaveBeenCalledWith({
      email: "tester@example.com",
      password: "password123",
      firstName: "Tester"
    });
    await app.close();
  });

  it("logs users in through local auth and returns tokens", async () => {
    const localAuth = mockLocalAuth();
    localAuth.login.mockResolvedValue({
      access_token: "access-token",
      expires_in: 300,
      refresh_token: "refresh-token",
      requiresPasswordChange: true,
      user: { id: "user-1", email: "tester@example.com", name: "Tester", roles: ["User"], permissions: ["auth.read.self"] },
      token_type: "Bearer"
    });
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), localAuth, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "Tester@Example.com",
        password: "password123"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      requiresPasswordChange: true
    });
    expect(localAuth.login).toHaveBeenCalledWith({
      email: "tester@example.com",
      password: "password123"
    });
    await app.close();
  });

  it("rejects password reset without a bearer token", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { currentPassword: "old-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("resets password for authenticated users", async () => {
    const localAuth = mockLocalAuth();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), localAuth, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { currentPassword: "old-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Password has been reset" });
    expect(localAuth.resetPassword).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: "old-password",
      newPassword: "new-password"
    });
    await app.close();
  });

  it("returns errors when current password verification fails", async () => {
    const localAuth = mockLocalAuth();
    localAuth.resetPassword.mockRejectedValue(new HttpError(401, "Invalid current password"));
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), localAuth, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { currentPassword: "wrong-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: "Invalid current password" });
    await app.close();
  });

  it("changes required password for migrated users", async () => {
    const localAuth = mockLocalAuth();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), localAuth, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/change-required",
      headers: { authorization: "Bearer token" },
      payload: { currentPassword: "temporary-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Password has been changed" });
    expect(localAuth.changeRequiredPassword).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: "temporary-password",
      newPassword: "new-password"
    });
    await app.close();
  });

  it("returns generic forgot password request responses", async () => {
    const passwordReset = mockPasswordReset();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), passwordReset, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/forgot/request",
      payload: { email: "Tester@Example.com" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "If the email exists, an OTP has been sent" });
    expect(passwordReset.requestForgotPassword).toHaveBeenCalledWith("tester@example.com");
    await app.close();
  });

  it("confirms forgot password OTPs", async () => {
    const passwordReset = mockPasswordReset();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), passwordReset, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/forgot/confirm",
      payload: {
        email: "Tester@Example.com",
        otp: "123456",
        newPassword: "new-password"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Password has been reset" });
    expect(passwordReset.confirmForgotPassword).toHaveBeenCalledWith({
      email: "tester@example.com",
      otp: "123456",
      newPassword: "new-password"
    });
    await app.close();
  });

  it("rejects protected routes without a bearer token", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), logger: false });

    const response = await app.inject({ method: "GET", url: "/records" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: "Missing bearer token" });
    await app.close();
  });

  it("returns records with total count and a next cursor", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => mockRecord(index + 1)) as Awaited<ReturnType<typeof prisma.record.findMany>>
    );
    vi.mocked(prisma.record.count).mockResolvedValue(57);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/records?limit=20" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(20);
    expect(body.nextCursor).toBe("11111111-1111-4111-8111-000000000020");
    expect(body.totalCount).toBe(57);
    expect(prisma.record.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { datetime: "desc" },
      take: 21
    });
    expect(prisma.record.count).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    await app.close();
  });

  it("returns records with total count and no next cursor on the last page", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => mockRecord(index + 1)) as Awaited<ReturnType<typeof prisma.record.findMany>>
    );
    vi.mocked(prisma.record.count).mockResolvedValue(57);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/records?limit=20&cursor=11111111-1111-4111-8111-000000000020"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
    expect(body.totalCount).toBe(57);
    expect(prisma.record.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { datetime: "desc" },
      take: 21,
      cursor: { id: "11111111-1111-4111-8111-000000000020" },
      skip: 1
    });
    expect(prisma.record.count).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    await app.close();
  });

  it("creates records for the authenticated user", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.create).mockResolvedValue({
      id: "record-1",
      userId: "user-1",
      datetime: new Date("2026-05-01T10:00:00.000Z"),
      bloodSugar: 120,
      medMorning: null,
      medEvening: null,
      note: null,
      createdAt: new Date()
    });
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/records",
      payload: {
        datetime: "2026-05-01T10:00:00.000Z",
        bloodSugar: 120
      }
    });

    expect(response.statusCode).toBe(201);
    expect(prisma.record.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", bloodSugar: 120 })
    });
    await app.close();
  });

  it("creates records with blood sugar 0 when not measured", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.create).mockResolvedValue({
      id: "record-1",
      userId: "user-1",
      datetime: new Date("2026-05-01T10:00:00.000Z"),
      bloodSugar: 0,
      medMorning: null,
      medEvening: null,
      note: "not measured",
      createdAt: new Date()
    });
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/records",
      payload: {
        datetime: "2026-05-01T10:00:00.000Z",
        bloodSugar: 0,
        note: "not measured"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(prisma.record.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", bloodSugar: 0, note: "not measured" })
    });
    await app.close();
  });

  it("rejects invalid blood sugar values", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), logger: false });

    for (const bloodSugar of [1, 601]) {
      const response = await app.inject({
        method: "POST",
        url: "/records",
        payload: {
          datetime: "2026-05-01T10:00:00.000Z",
          bloodSugar
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ ok: false });
    }
    await app.close();
  });

  it("updates records with blood sugar 0 when not measured", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findFirst).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      datetime: new Date("2026-05-01T10:00:00.000Z"),
      bloodSugar: 120,
      medMorning: null,
      medEvening: null,
      note: null,
      createdAt: new Date()
    });
    vi.mocked(prisma.record.update).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      datetime: new Date("2026-05-01T10:00:00.000Z"),
      bloodSugar: 0,
      medMorning: null,
      medEvening: null,
      note: null,
      createdAt: new Date()
    });
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/records/11111111-1111-4111-8111-111111111111",
      payload: { bloodSugar: 0 }
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.record.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: { bloodSugar: 0, datetime: undefined }
    });
    await app.close();
  });

  it("scopes record update by user ownership", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findFirst).mockResolvedValue(null);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/records/11111111-1111-4111-8111-111111111111",
      payload: { bloodSugar: 125 }
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.record.findFirst).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111", userId: "user-1" },
      select: { id: true }
    });
    await app.close();
  });

  it("computes dashboard response shape", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.aggregate).mockResolvedValue({
      _avg: { bloodSugar: 120 },
      _min: { bloodSugar: 80 },
      _max: { bloodSugar: 180 },
      _count: { bloodSugar: 3 },
      _sum: { bloodSugar: 360 }
    });
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-01T10:00:00.000Z"),
        bloodSugar: 120
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/dashboard?range=7d" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      range: "7d",
      widgets: {
        summary: {
          status: "ok",
          data: {
            avg: 120,
            min: 120,
            max: 120,
            count: 1
          }
        },
        trend: {
          status: "ok",
          data: [{ datetime: "2026-05-01T10:00:00.000Z", value: 120 }]
        }
      }
    });
    await app.close();
  });

  it("returns default normalized dashboard preferences when no preference exists", async () => {
    const prisma = mockPrisma();
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/dashboard/preferences" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      widgets: ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"]
    });
    expect(prisma.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { dashboardWidgets: true }
    });
    await app.close();
  });

  it("normalizes stored dashboard preferences", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
      dashboardWidgets: ["trend", "summary", "trend", "bmi"]
    } as Awaited<ReturnType<typeof prisma.userPreference.findUnique>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/dashboard/preferences" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ widgets: ["summary", "trend", "bmi"] });
    await app.close();
  });

  it("updates dashboard preferences with normalized widget order", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
      dashboardWidgets: { bloodSugar: ["summary"], weight: ["summary", "goalProgress"] }
    } as unknown as Awaited<ReturnType<typeof prisma.userPreference.findUnique>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/dashboard/preferences",
      payload: { widgets: ["trend", "summary", "trend", "bmi"] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ widgets: ["summary", "trend", "bmi"] });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { dashboardWidgets: { bloodSugar: ["summary", "trend", "bmi"], weight: ["summary", "goalProgress"] } },
      create: { userId: "user-1", dashboardWidgets: { bloodSugar: ["summary", "trend", "bmi"], weight: ["summary", "goalProgress"] } }
    });
    await app.close();
  });

  it("keeps summary as the only dashboard preference for empty updates", async () => {
    const prisma = mockPrisma();
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/dashboard/preferences",
      payload: { widgets: [] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ widgets: ["summary"] });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { dashboardWidgets: { bloodSugar: ["summary"], weight: ["summary", "trend", "forecast"] } },
      create: { userId: "user-1", dashboardWidgets: { bloodSugar: ["summary"], weight: ["summary", "trend", "forecast"] } }
    });
    await app.close();
  });

  it("rejects unknown dashboard preference widget keys", async () => {
    const prisma = mockPrisma();
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/dashboard/preferences",
      payload: { widgets: ["summary", "unknownWidget"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false });
    expect(prisma.userPreference.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the selected 30 day range for regular dashboard widgets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));

    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany)
      .mockResolvedValueOnce([
        {
          datetime: new Date("2026-05-06T10:00:00.000Z"),
          bloodSugar: 120,
          medMorning: null,
          medEvening: null,
          note: null
        },
        {
          datetime: new Date("2026-05-07T10:00:00.000Z"),
          bloodSugar: 200,
          medMorning: null,
          medEvening: null,
          note: "high"
        }
      ] as Awaited<ReturnType<typeof prisma.record.findMany>>)
      .mockResolvedValueOnce([
        {
          datetime: new Date("2026-03-20T10:00:00.000Z"),
          bloodSugar: 150,
          medMorning: null,
          medEvening: null,
          note: "previous period"
        },
        {
          datetime: new Date("2026-05-06T10:00:00.000Z"),
          bloodSugar: 120,
          medMorning: null,
          medEvening: null,
          note: null
        },
        {
          datetime: new Date("2026-05-07T10:00:00.000Z"),
          bloodSugar: 200,
          medMorning: null,
          medEvening: null,
          note: "high"
        }
      ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?range=30d&widgets=summary,trend,timeInRange,recentAlerts,periodComparison"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      widgets: {
        summary: {
          status: "ok",
          data: { avg: 160, min: 120, max: 200, count: 2 }
        },
        trend: {
          status: "ok",
          data: [
            { datetime: "2026-05-06T10:00:00.000Z", value: 120 },
            { datetime: "2026-05-07T10:00:00.000Z", value: 200 }
          ]
        },
        timeInRange: {
          status: "ok",
          data: {
            total: 2,
            normal: { count: 1, percent: 50 },
            high: { count: 1, percent: 50 },
            low: { count: 0, percent: 0 }
          }
        },
        recentAlerts: {
          status: "ok",
          data: [{ datetime: "2026-05-07T10:00:00.000Z", bloodSugar: 200, level: "high", note: "high" }]
        },
        periodComparison: {
          status: "ok",
          data: {
            current: { avg: 160, count: 2 },
            previous: { avg: 150, count: 1 },
            change: 10
          }
        }
      }
    });
    expect(prisma.record.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: "user-1", datetime: { gte: new Date("2026-04-07T12:00:00.000Z") } }
      })
    );
    expect(prisma.record.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: "user-1", datetime: { gte: new Date("2026-03-08T12:00:00.000Z") } }
      })
    );
    await app.close();
  });

  it("excludes blood sugar 0 from dashboard glucose analytics", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-01T10:00:00.000Z"),
        bloodSugar: 0,
        medMorning: 1,
        medEvening: null,
        note: "not measured"
      },
      {
        datetime: new Date("2026-05-02T10:00:00.000Z"),
        bloodSugar: 120,
        medMorning: null,
        medEvening: null,
        note: null
      },
      {
        datetime: new Date("2026-05-03T10:00:00.000Z"),
        bloodSugar: 200,
        medMorning: null,
        medEvening: null,
        note: "high"
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?range=all&widgets=summary,trend,timeInRange,recentAlerts,medAdherence"
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" }
      })
    );
    expect(response.json()).toMatchObject({
      widgets: {
        summary: {
          status: "ok",
          data: {
            avg: 160,
            min: 120,
            max: 200,
            count: 2
          }
        },
        trend: {
          status: "ok",
          data: [
            { datetime: "2026-05-02T10:00:00.000Z", value: 120 },
            { datetime: "2026-05-03T10:00:00.000Z", value: 200 }
          ]
        },
        timeInRange: {
          status: "ok",
          data: {
            total: 2,
            normal: { count: 1, percent: 50 },
            high: { count: 1, percent: 50 },
            low: { count: 0, percent: 0 }
          }
        },
        recentAlerts: {
          status: "ok",
          data: [{ datetime: "2026-05-03T10:00:00.000Z", bloodSugar: 200, level: "high", note: "high" }]
        },
        medAdherence: {
          status: "ok",
          data: {
            totalDays: 3,
            morning: { days: 1 }
          }
        }
      }
    });
    await app.close();
  });

  it("exports pdf with a 1000 record cap", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([]);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/export?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(countPdfPages(response.rawPayload)).toBe(1);
    expect(getFirstPdfMediaBox(response.rawPayload)).toMatchObject({ width: 595.28, height: 841.89 });
    expect(prisma.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        take: 1000
      })
    );
    await app.close();
  });

  it("exports one-page portrait pdfs with Thai text", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-05T14:27:00.000Z"),
        bloodSugar: 0,
        medMorning: 20,
        medEvening: 20,
        note: "วัดไม่ได้ อาหารเย็น"
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({
      config,
      prisma,
      authenticate: mockAuth("user-1"),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/export?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeGreaterThan(0);
    expect(countPdfPages(response.rawPayload)).toBe(1);
    const mediaBox = getFirstPdfMediaBox(response.rawPayload);
    expect(mediaBox.height).toBeGreaterThan(mediaBox.width);
    expect(response.rawPayload.toString("latin1")).toContain("/FontFile");
    await app.close();
  });

  it("exports portrait pdfs with wrapped long Thai notes", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-05T14:27:00.000Z"),
        bloodSugar: 0,
        medMorning: 20,
        medEvening: 20,
        note: "วัดไม่ได้ อาหารเย็น ".repeat(35).trim()
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/export?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeGreaterThan(0);
    const mediaBox = getFirstPdfMediaBox(response.rawPayload);
    expect(mediaBox.height).toBeGreaterThan(mediaBox.width);
    expect(response.rawPayload.toString("latin1")).toContain("/FontFile");
    await app.close();
  });

  it("exports portrait pdfs with numbers, symbols, and emoji in Thai notes", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-05T14:27:00.000Z"),
        bloodSugar: 0,
        medMorning: 20,
        medEvening: 20,
        note: "*ระดับน้ำตาล 0 คือไม่ได้เจาะตรวจ #1 @home ✓ ≤70 ≥180 🙂"
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/export?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(countPdfPages(response.rawPayload)).toBe(1);
    expect(getFirstPdfMediaBox(response.rawPayload)).toMatchObject({ width: 595.28, height: 841.89 });
    expect(response.rawPayload.toString("latin1")).toContain("/FontFile");
    await app.close();
  });

  it("exports excel workbooks and marks unmeasured records", async () => {
    vi.setSystemTime(new Date("2026-06-12T03:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-01T10:00:00.000Z"),
        bloodSugar: 0,
        medMorning: 1,
        medEvening: null,
        note: "วัดไม่ได้ อาหารเย็น"
      },
      {
        datetime: new Date("2026-05-02T10:00:00.000Z"),
        bloodSugar: 120,
        medMorning: null,
        medEvening: null,
        note: "before breakfast"
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/export?type=excel" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(response.headers["content-disposition"]).toContain("blood-sugar-report-20260612.xlsx");
    expect(response.rawPayload.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const summary = workbook.getWorksheet("Summary");
    const records = workbook.getWorksheet("Blood Sugar Data");

    expect(summary?.getCell("A1").value).toBe("Blood Sugar Report");
    expect(summary?.getCell("B3").value).toBe("Blood Sugar Report");
    expect(summary?.getCell("B4").value).toBe("Blood Sugar");
    expect(summary?.getCell("B8").value).toBe("12 Jun 2026 10:00 ICT");
    expect(summary?.getCell("B12").value).toBe("120 mg/dL");
    expect(summary?.getCell("B13").value).toBe("120 mg/dL");
    expect(records?.getCell("A1").value).toBe("Date");
    expect(records?.getCell("B1").value).toBe("Time");
    expect(records?.getCell("C1").value).toBe("Reading");
    expect(records?.getCell("D1").value).toBe("Status");
    expect(records?.getCell("C2").value).toBe(0);
    expect(records?.getCell("D2").value).toBe("Not measured");
    expect(records?.getCell("D3").value).toBe("Normal");
    await app.close();
  });

  it("exports weight progress excel reports with summary and log sheets", async () => {
    vi.setSystemTime(new Date("2026-06-12T03:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=excel" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(response.headers["content-disposition"]).toContain("weight-report-20260612.xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const summary = workbook.getWorksheet("Summary");
    const log = workbook.getWorksheet("Weight Data");

    expect(summary?.getCell("A1").value).toBe("Weight Progress Report");
    expect(summary?.getCell("B3").value).toBe("Weight Progress Report");
    expect(summary?.getCell("B4").value).toBe("Weight");
    expect(summary?.getCell("B5").value).toBe("Tester");
    expect(summary?.getCell("B8").value).toBe("12 Jun 2026 10:00 ICT");
    expect(summary?.getCell("B12").value).toBe("148 kg");
    expect(log?.getCell("A1").value).toBe("Date");
    expect(log?.getCell("B1").value).toBe("Weight");
    expect(log?.getCell("C1").value).toBe("7-Day Average");
    expect(log?.getCell("D1").value).toBe("Forecast");
    expect(log?.getCell("E1").value).toBe("Delta");
    expect(log?.getCell("A4").value).toBe("2026-06-03");
    expect(log?.getCell("B4").value).toBe(148);
    expect(log?.getCell("C4").value).toBe(149);
    await app.close();
  });

  it("exports weight progress pdf reports", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("weight-report-");
    expect(countPdfPages(response.rawPayload)).toBe(1);
    expect(getFirstPdfMediaBox(response.rawPayload)).toMatchObject({ width: 595.28, height: 841.89 });
    await app.close();
  });

  it("exports weight progress reports with entries but no goal", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=excel" });

    expect(response.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const summary = workbook.getWorksheet("Summary");
    const log = workbook.getWorksheet("Weight Data");

    expect(summary?.getCell("B12").value).toBe("149 kg");
    expect(summary?.getCell("B14").value).toBe("-");
    expect(log?.getCell("D2").value).toBe("-");
    expect(log?.getCell("E2").value).toBe("-");
    await app.close();
  });

  it("exports empty weight progress reports", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=excel" });

    expect(response.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const summary = workbook.getWorksheet("Summary");
    const log = workbook.getWorksheet("Weight Data");

    expect(summary?.getCell("B6").value).toBe("-");
    expect(summary?.getCell("B12").value).toBe("-");
    expect(summary?.getCell("B15").value).toBe("-");
    expect(log?.actualRowCount).toBe(1);
    await app.close();
  });

  it("exports weight progress with a 1000 entry cap", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([]);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=pdf" });

    expect(response.statusCode).toBe(200);
    expect(prisma.healthMetricEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          metricType: "weight_kg"
        },
        orderBy: { date: "asc" },
        take: 1000
      })
    );
    await app.close();
  });

  it("requires export permission for weight progress exports", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", ["weights.read.self"]),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=excel" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "Permission denied: export.read.self" });
    await app.close();
  });

  it("requires weight read permission for weight progress exports", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", ["export.read.self"]),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/health-progress/export/weight?type=excel" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "Permission denied: weights.read.self" });
    await app.close();
  });

  it("serves canonical health blood sugar entry endpoints", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.create).mockResolvedValue({
      id: "record-1",
      userId: "user-1",
      datetime: new Date("2026-06-01T08:00:00.000Z"),
      bloodSugar: 122,
      medMorning: 1,
      medEvening: null,
      note: null,
      createdAt: new Date("2026-06-01T08:00:00.000Z")
    } as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/health/blood-sugar/entries",
      payload: {
        datetime: "2026-06-01T08:00:00.000Z",
        bloodSugar: 122,
        medMorning: 1
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: "record-1", bloodSugar: 122 });
    expect(prisma.record.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", bloodSugar: 122 })
    });
    await app.close();
  });

  it("serves canonical health weight forecast endpoint", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/weight/forecast?range=all" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ahead", metricType: "weight_kg" });
    await app.close();
  });

  it("returns unified health dashboard widgets for selected blood sugar data", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      { datetime: new Date("2026-06-01T08:00:00.000Z"), bloodSugar: 120, medMorning: 1, medEvening: null, note: null },
      { datetime: new Date("2026-06-02T08:00:00.000Z"), bloodSugar: 200, medMorning: 1, medEvening: null, note: "high" }
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/dashboard?range=7d&dataTypes=bloodSugar&widgets=summary,trend,timeInRange" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      range: "7d",
      dataTypes: ["bloodSugar"],
      availableDataTypes: ["bloodSugar", "weight"],
      availableWidgets: {
        bloodSugar: expect.arrayContaining(["summary", "trend", "timeInRange"])
      },
      defaultWidgets: {
        bloodSugar: expect.arrayContaining(["summary", "trend"])
      },
      widgets: {
        bloodSugar: {
          summary: { status: "ok", data: { avg: 160, min: 120, max: 200, count: 2 } },
          trend: {
            status: "ok",
            data: [
              { datetime: "2026-06-01T08:00:00.000Z", value: 120 },
              { datetime: "2026-06-02T08:00:00.000Z", value: 200 }
            ]
          },
          timeInRange: {
            status: "ok",
            data: {
              total: 2,
              normal: { count: 1, percent: 50 },
              high: { count: 1, percent: 50 },
              low: { count: 0, percent: 0 }
            }
          }
        }
      }
    });
    await app.close();
  });

  it("returns unified health dashboard widgets for selected blood sugar and weight data", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      { datetime: new Date("2026-06-01T08:00:00.000Z"), bloodSugar: 120, medMorning: 1, medEvening: null, note: null }
    ] as never);
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/dashboard?range=all&dataTypes=bloodSugar,weight&widgets=summary,trend,forecast" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      dataTypes: ["bloodSugar", "weight"],
      widgets: {
        bloodSugar: {
          summary: { status: "ok" },
          trend: { status: "ok" }
        },
        weight: {
          summary: { status: "ok" },
          trend: { status: "ok" },
          forecast: { status: "ok", data: { status: "ahead" } }
        }
      }
    });
    await app.close();
  });

  it("rejects dashboard widgets unsupported by the selected health data types", async () => {
    const prisma = mockPrisma();
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/dashboard?dataTypes=bloodSugar&widgets=forecast" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false });
    expect(prisma.record.findMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns canonical health dashboard preferences with per-data-type defaults", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
      dashboardWidgets: ["trend", "summary", "bmi"]
    } as Awaited<ReturnType<typeof prisma.userPreference.findUnique>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/dashboard/preferences" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      widgets: {
        bloodSugar: ["summary", "trend"],
        weight: ["summary", "trend", "forecast"]
      }
    });
    await app.close();
  });

  it("updates canonical health dashboard preferences per data type", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
      dashboardWidgets: { bloodSugar: ["summary", "trend"], weight: ["summary", "trend", "forecast"] }
    } as unknown as Awaited<ReturnType<typeof prisma.userPreference.findUnique>>);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/health/dashboard/preferences",
      payload: { widgets: { bloodSugar: ["trend", "timeInRange"], weight: ["forecast", "goalProgress"] } }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      widgets: {
        bloodSugar: ["summary", "trend", "timeInRange"],
        weight: ["summary", "forecast", "goalProgress"]
      }
    });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { dashboardWidgets: { bloodSugar: ["summary", "trend", "timeInRange"], weight: ["summary", "forecast", "goalProgress"] } },
      create: { userId: "user-1", dashboardWidgets: { bloodSugar: ["summary", "trend", "timeInRange"], weight: ["summary", "forecast", "goalProgress"] } }
    });
    await app.close();
  });

  it("exports unified health excel reports with selected blood sugar and weight data", async () => {
    vi.setSystemTime(new Date("2026-06-12T03:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      { datetime: new Date("2026-06-01T08:00:00.000Z"), bloodSugar: 120, medMorning: 1, medEvening: null, note: null }
    ] as never);
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/export?type=excel&dataTypes=weight,bloodSugar" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("health-report-20260612.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Overview", "Weight", "Blood Sugar"]);
    const overview = workbook.getWorksheet("Overview");
    expect(overview?.getCell("A1").value).toBe("Health Report");
    expect(overview?.getCell("B4").value).toBe("Weight, Blood Sugar");
    expect(overview?.getCell("A11").value).toBe("Metric");
    expect(overview?.getCell("A12").value).toBe("Weight");
    expect(overview?.getCell("A13").value).toBe("Blood Sugar");
    expect(workbook.getWorksheet("Blood Sugar")).toBeTruthy();
    expect(workbook.getWorksheet("Weight")).toBeTruthy();
    await app.close();
  });

  it("exports canonical health blood sugar excel reports with standard filenames and sheets", async () => {
    vi.setSystemTime(new Date("2026-06-12T03:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      { datetime: new Date("2026-06-01T08:00:00.000Z"), bloodSugar: 120, medMorning: 1, medEvening: null, note: null }
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/export?type=excel&dataTypes=bloodSugar" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("blood-sugar-report-20260612.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Blood Sugar Data"]);
    expect(workbook.getWorksheet("Summary")?.getCell("B4").value).toBe("Blood Sugar");
    await app.close();
  });

  it("exports canonical health weight pdf reports with standard filenames", async () => {
    vi.setSystemTime(new Date("2026-06-12T03:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([mockHealthMetricEntry("2026-06-01", 150, 1)] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health/export?type=pdf&dataTypes=weight" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("weight-report-20260612.pdf");
    expect(countPdfPages(response.rawPayload)).toBe(1);
    expect(response.rawPayload.toString("latin1")).toContain("/FontFile");
    await app.close();
  });

  it("creates shared links with a hashed token and returns the one-time token", async () => {
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.record.count).mockResolvedValue(2);
    vi.mocked(prisma.sharedLink.create).mockImplementation((async (args: unknown) => {
      const data = (args as {
        data: {
          dataStartAt: Date;
          dataEndAt: Date;
          expiresAt: Date;
          publicToken: string;
        };
      }).data;
      return mockSharedLink({
        dataStartAt: data.dataStartAt,
        dataEndAt: data.dataEndAt,
        expiresAt: data.expiresAt,
        publicToken: data.publicToken
      });
    }) as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-31T23:59:59.999Z",
        expiresInDays: 7
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      dataStartAt: "2026-05-01T00:00:00.000Z",
      dataEndAt: "2026-05-31T23:59:59.999Z",
      expiresAt: "2026-05-15T00:00:00.000Z",
      status: "active"
    });
    expect(body.token).toEqual(expect.any(String));
    expect(body.publicPath).toBe(`/shared/${body.token}`);
    const createArg = vi.mocked(prisma.sharedLink.create).mock.calls[0][0];
    const createData = createArg.data as { tokenHash: string; publicToken: string };
    expect(createData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.tokenHash).not.toBe(body.token);
    expect(createData.publicToken).toBe(body.token);
    expect(body.revokedAt).toBeNull();
    await app.close();
  });

  it("creates shared links with selected health data types", async () => {
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.record.count).mockResolvedValue(1);
    vi.mocked(prisma.healthMetricEntry.count).mockResolvedValue(2);
    vi.mocked(prisma.sharedLink.create).mockImplementation((async (args: unknown) => {
      const data = (args as {
        data: {
          dataStartAt: Date;
          dataEndAt: Date;
          expiresAt: Date;
          publicToken: string;
          dataTypes: string[];
        };
      }).data;
      return mockSharedLink({
        dataStartAt: data.dataStartAt,
        dataEndAt: data.dataEndAt,
        expiresAt: data.expiresAt,
        publicToken: data.publicToken,
        dataTypes: data.dataTypes
      });
    }) as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-31T23:59:59.999Z",
        expiresInDays: 7,
        dataTypes: ["bloodSugar", "weight"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().dataTypes).toEqual(["bloodSugar", "weight"]);
    expect(((vi.mocked(prisma.sharedLink.create).mock.calls[0][0].data as unknown) as { dataTypes: string[] }).dataTypes).toEqual([
      "bloodSugar",
      "weight"
    ]);
    await app.close();
  });

  it("rejects invalid shared link date ranges and expiry days", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), logger: false });

    const endBeforeStart = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-02T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        expiresInDays: 7
      }
    });
    const tooLong = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        expiresInDays: 7
      }
    });
    const invalidExpiry = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-02T00:00:00.000Z",
        expiresInDays: 14
      }
    });

    expect(endBeforeStart.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(invalidExpiry.statusCode).toBe(400);
    await app.close();
  });

  it("rejects invalid and empty shared link data type selections", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), logger: false });

    const invalid = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-02T00:00:00.000Z",
        expiresInDays: 7,
        dataTypes: ["sleep"]
      }
    });
    const empty = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-02T00:00:00.000Z",
        expiresInDays: 7,
        dataTypes: []
      }
    });

    expect(invalid.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    await app.close();
  });

  it("rejects shared link creation when selected records exceed the limit", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.count).mockResolvedValue(1001);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/shared-links",
      payload: {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-31T23:59:59.999Z",
        expiresInDays: 7
      }
    });

    expect(response.statusCode).toBe(400);
    expect(vi.mocked(prisma.sharedLink.create)).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists shared links with active public paths and without raw tokens", async () => {
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
    const prisma = mockPrisma();
    vi.mocked(prisma.sharedLink.findMany).mockResolvedValue([
      mockSharedLink({ id: "active", expiresAt: new Date("2026-05-09T00:00:00.000Z"), publicToken: "active-token" }),
      mockSharedLink({ id: "legacy", expiresAt: new Date("2026-05-09T00:00:00.000Z"), publicToken: null }),
      mockSharedLink({ id: "expired", expiresAt: new Date("2026-05-07T00:00:00.000Z"), publicToken: "expired-token" }),
      mockSharedLink({ id: "revoked", revokedAt: new Date("2026-05-06T00:00:00.000Z"), publicToken: "revoked-token" })
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/shared-links" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({ id: "active", status: "active", publicPath: "/shared/active-token" }),
      expect.objectContaining({ id: "legacy", status: "active", publicPath: null }),
      expect.objectContaining({ id: "expired", status: "expired", publicPath: null }),
      expect.objectContaining({ id: "revoked", status: "revoked", publicPath: null, revokedAt: "2026-05-06T00:00:00.000Z" })
    ]);
    expect(response.json().data[0]).not.toHaveProperty("token");
    expect(response.json().data[0]).not.toHaveProperty("publicToken");
    await app.close();
  });

  it("revokes owner shared links and blocks public access immediately", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.sharedLink.findFirst).mockResolvedValue(mockSharedLink() as never);
    vi.mocked(prisma.sharedLink.update).mockResolvedValue(
      mockSharedLink({ revokedAt: new Date("2026-05-08T00:00:00.000Z") }) as never
    );
    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValue(
      {
        ...mockSharedLink({ revokedAt: new Date("2026-05-08T00:00:00.000Z") }),
        user: { name: "Tester", email: "tester@example.com", profile: null }
      } as never
    );
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const revokeResponse = await app.inject({
      method: "POST",
      url: "/shared-links/22222222-2222-4222-8222-222222222222/revoke"
    });
    const publicResponse = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.json()).toMatchObject({ status: "revoked", revokedAt: "2026-05-08T00:00:00.000Z" });
    expect(publicResponse.statusCode).toBe(404);
    await app.close();
  });

  it("does not let users revoke shared links they do not own", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.sharedLink.findFirst).mockResolvedValue(null);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-2"), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/shared-links/22222222-2222-4222-8222-222222222222/revoke"
    });

    expect(response.statusCode).toBe(404);
    expect(vi.mocked(prisma.sharedLink.update)).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns public shared link payload without authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));

    const prisma = mockPrisma();
    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValue(
      {
        ...mockSharedLink({ expiresAt: new Date("2026-06-07T00:00:00.000Z") }),
        user: {
          name: "Tester",
          email: "tester@example.com",
          profile: { weight: 70, height: 170 }
        }
      } as never
    );
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        datetime: new Date("2026-05-02T10:00:00.000Z"),
        bloodSugar: 120,
        medMorning: 1,
        medEvening: null,
        note: "before breakfast"
      }
    ] as Awaited<ReturnType<typeof prisma.record.findMany>>);
    vi.mocked(prisma.record.count).mockResolvedValue(1);
    const app = await buildApp({ config, prisma, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      patient: {
        name: "Tester",
        email: "tester@example.com",
        weight: 70,
        height: 170
      },
      sharedLink: {
        dataStartAt: "2026-05-01T00:00:00.000Z",
        dataEndAt: "2026-05-31T23:59:59.999Z",
        expiresAt: "2026-06-07T00:00:00.000Z",
        status: "active",
        dataTypes: ["bloodSugar"]
      },
      records: [
        {
          datetime: "2026-05-02T10:00:00.000Z",
          bloodSugar: 120,
          medMorning: 1,
          medEvening: null,
          note: "before breakfast"
        }
      ],
      meta: {
        totalCount: 1,
        returnedCount: 1,
        limit: 1000
      }
    });
    expect(response.json().data.bloodSugar.records).toEqual(response.json().records);
    expect(response.json().data.bloodSugar.summary.status).toBe("ok");
    expect(prisma.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          datetime: {
            gte: new Date("2026-05-01T00:00:00.000Z"),
            lte: new Date("2026-05-31T23:59:59.999Z")
          }
        },
        orderBy: { datetime: "asc" },
        take: 1000
      })
    );
    await app.close();
  });

  it("returns public shared link payload with selected weight data only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));

    const prisma = mockPrisma();
    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValue(
      {
        ...mockSharedLink({ expiresAt: new Date("2026-06-07T00:00:00.000Z"), dataTypes: ["weight"] }),
        user: {
          name: "Tester",
          email: "tester@example.com",
          profile: { weight: 70, height: 170 }
        }
      } as never
    );
    vi.mocked(prisma.healthMetricEntry.count).mockResolvedValue(3);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    const app = await buildApp({ config, prisma, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().records).toBeUndefined();
    expect(response.json().sharedLink.dataTypes).toEqual(["weight"]);
    expect(response.json().data.weight.entries).toHaveLength(3);
    expect(response.json().data.weight.forecastSummary.status).toBe("ahead");
    expect(response.json().data.bloodSugar).toBeUndefined();
    await app.close();
  });

  it("returns 404 for unknown, expired, and revoked public shared link tokens", async () => {
    const prisma = mockPrisma();
    const app = await buildApp({ config, prisma, logger: false });

    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValueOnce(null);
    const unknown = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValueOnce(
      {
        ...mockSharedLink({ expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
        user: { name: "Tester", email: "tester@example.com", profile: null }
      } as never
    );
    const expired = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    vi.mocked(prisma.sharedLink.findUnique).mockResolvedValueOnce(
      {
        ...mockSharedLink({ revokedAt: new Date("2026-05-01T00:00:00.000Z") }),
        user: { name: "Tester", email: "tester@example.com", profile: null }
      } as never
    );
    const revoked = await app.inject({
      method: "GET",
      url: "/public/shared-links/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"
    });

    expect(unknown.statusCode).toBe(404);
    expect(expired.statusCode).toBe(404);
    expect(revoked.statusCode).toBe(404);
    await app.close();
  });

  it("creates or replaces the active weight progress goal", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.upsert).mockResolvedValue(mockHealthGoal() as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/health-progress/goals/weight",
      payload: {
        startDate: "2026-06-01",
        targetDate: "2026-06-30",
        startValue: 150,
        targetValue: 140
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metricType: "weight_kg",
      startDate: "2026-06-01",
      targetDate: "2026-06-30",
      startValue: 150,
      targetValue: 140
    });
    expect(prisma.healthGoal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_metricType: { userId: "user-1", metricType: "weight_kg" } },
        update: expect.objectContaining({ startValue: 150, targetValue: 140 }),
        create: expect.objectContaining({ userId: "user-1", metricType: "weight_kg" })
      })
    );
    await app.close();
  });

  it("upserts one weight metric entry per date", async () => {
    const prisma = mockPrisma();
    const entry = mockHealthMetricEntry("2026-06-02", 149.2);
    vi.mocked(prisma.healthMetricEntry.upsert).mockResolvedValue(entry as never);
    vi.mocked(prisma.healthMetricEntry.findFirst).mockResolvedValue(entry as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/health-progress/metrics/weight/2026-06-02",
      payload: { value: 149.2 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metricType: "weight_kg",
      date: "2026-06-02",
      value: 149.2
    });
    expect(prisma.healthMetricEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_metricType_date: {
            userId: "user-1",
            metricType: "weight_kg",
            date: new Date("2026-06-02T00:00:00.000Z")
          }
        },
        update: { value: 149.2 },
        create: expect.objectContaining({ userId: "user-1", metricType: "weight_kg", value: 149.2 })
      })
    );
    expect(prisma.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { weight: 149.2 },
      create: { userId: "user-1", weight: 149.2 }
    });
    await app.close();
  });

  it("syncs profile weight when upserting canonical weight entries", async () => {
    const prisma = mockPrisma();
    const entry = mockHealthMetricEntry("2026-06-02", 149.2);
    vi.mocked(prisma.healthMetricEntry.upsert).mockResolvedValue(entry as never);
    vi.mocked(prisma.healthMetricEntry.findFirst).mockResolvedValue(entry as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/health/weight/entries/2026-06-02",
      payload: { value: 149.2 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metricType: "weight_kg",
      date: "2026-06-02",
      value: 149.2
    });
    expect(prisma.healthMetricEntry.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", metricType: "weight_kg" },
      orderBy: { date: "desc" }
    });
    expect(prisma.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { weight: 149.2 },
      create: { userId: "user-1", weight: 149.2 }
    });
    await app.close();
  });

  it("keeps profile weight on the latest dated entry when editing older weight entries", async () => {
    const prisma = mockPrisma();
    const editedEntry = mockHealthMetricEntry("2026-06-01", 151.4, 1);
    const latestEntry = mockHealthMetricEntry("2026-06-03", 148.8, 3);
    vi.mocked(prisma.healthMetricEntry.upsert).mockResolvedValue(editedEntry as never);
    vi.mocked(prisma.healthMetricEntry.findFirst).mockResolvedValue(latestEntry as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "PUT",
      url: "/health/weight/entries/2026-06-01",
      payload: { value: 151.4 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metricType: "weight_kg",
      date: "2026-06-01",
      value: 151.4
    });
    expect(prisma.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { weight: 148.8 },
      create: { userId: "user-1", weight: 148.8 }
    });
    await app.close();
  });

  it("lists weight metric entries with pagination metadata", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => mockHealthMetricEntry(`2026-06-0${index + 1}`, 150 - index, index + 1)) as never
    );
    vi.mocked(prisma.healthMetricEntry.count).mockResolvedValue(3);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/health-progress/metrics/weight?from=2026-06-01&to=2026-06-30&limit=2"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totalCount: 3,
      nextCursor: "33333333-3333-4333-8333-000000000002"
    });
    expect(response.json().data).toHaveLength(2);
    expect(prisma.healthMetricEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          metricType: "weight_kg",
          date: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-06-30T00:00:00.000Z")
          }
        },
        orderBy: { date: "desc" },
        take: 3
      })
    );
    await app.close();
  });

  it("deletes weight metric entries by owner and date", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthMetricEntry.deleteMany).mockResolvedValue({ count: 1 } as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({
      method: "DELETE",
      url: "/health-progress/metrics/weight/2026-06-02"
    });

    expect(response.statusCode).toBe(204);
    expect(prisma.healthMetricEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        metricType: "weight_kg",
        date: new Date("2026-06-02T00:00:00.000Z")
      }
    });
    await app.close();
  });

  it("returns insufficient forecast data when the weight goal is missing", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/forecast/weight" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metricType: "weight_kg",
      status: "insufficient_data",
      message: "Weight goal is required to calculate forecast",
      goal: null
    });
    await app.close();
  });

  it("returns insufficient forecast data when weight entries are missing", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/forecast/weight?range=all" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "insufficient_data",
      message: "At least one weight entry is required to compare actual progress",
      goal: expect.objectContaining({ metricType: "weight_kg" }),
      cards: null
    });
    expect(response.json().series.forecast.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns forecast series, trend, progress, and ETA for enough weight entries", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 149, 2),
      mockHealthMetricEntry("2026-06-03", 148, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/forecast/weight?range=all" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ahead",
      cards: {
        currentValue: 148,
        lowestValue: 148,
        highestValue: 150,
        totalChange: -2,
        trendKgPerWeek: -7,
        eta: {
          status: "ok",
          daysRemaining: 8,
          weeksRemaining: 1.1,
          estimatedDate: "2026-06-11"
        },
        targetProgress: {
          percent: 20,
          remainingValue: -8
        }
      }
    });
    expect(response.json().series.actual).toHaveLength(3);
    expect(response.json().series.rollingAverage).toEqual([
      { date: "2026-06-01", value: 150 },
      { date: "2026-06-02", value: 149.5 },
      { date: "2026-06-03", value: 149 }
    ]);
    await app.close();
  });

  it("classifies forecast status as on track and behind", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany)
      .mockResolvedValueOnce([
        mockHealthMetricEntry("2026-06-01", 150, 1),
        mockHealthMetricEntry("2026-06-02", 149.7, 2),
        mockHealthMetricEntry("2026-06-03", 149.3, 3)
      ] as never)
      .mockResolvedValueOnce([
        mockHealthMetricEntry("2026-06-01", 150, 1),
        mockHealthMetricEntry("2026-06-02", 150.1, 2),
        mockHealthMetricEntry("2026-06-03", 150.2, 3)
      ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const onTrack = await app.inject({ method: "GET", url: "/health-progress/forecast/weight?range=all" });
    const behind = await app.inject({ method: "GET", url: "/health-progress/forecast/weight?range=all" });

    expect(onTrack.statusCode).toBe(200);
    expect(onTrack.json().status).toBe("on_track");
    expect(behind.statusCode).toBe(200);
    expect(behind.json().status).toBe("behind");
    await app.close();
  });

  it("returns unavailable ETA when the current trend moves away from target", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.healthGoal.findUnique).mockResolvedValue(mockHealthGoal() as never);
    vi.mocked(prisma.healthMetricEntry.findMany).mockResolvedValue([
      mockHealthMetricEntry("2026-06-01", 150, 1),
      mockHealthMetricEntry("2026-06-02", 151, 2),
      mockHealthMetricEntry("2026-06-03", 152, 3)
    ] as never);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/health-progress/forecast/weight?range=all" });

    expect(response.statusCode).toBe(200);
    expect(response.json().cards.eta).toEqual({
      status: "not_progressing",
      daysRemaining: null,
      weeksRemaining: null,
      estimatedDate: null
    });
    await app.close();
  });

  it("enforces permissions for health progress routes", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", []),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/health-progress/forecast/weight" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "Permission denied: weights.read.self" });
    await app.close();
  });

  it("returns roles and permissions from auth me", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", ["auth.read.self", "weights.read.self"]),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/auth/me" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      roles: ["Admin"],
      permissions: ["auth.read.self", "weights.read.self"]
    });
    await app.close();
  });

  it("returns 403 when authenticated users lack route permission", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", []),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/records" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "Permission denied: records.read.self" });
    await app.close();
  });

  it("lists permission catalog for role management", async () => {
    const app = await buildApp({
      config,
      prisma: mockPrisma(),
      authenticate: mockAuth("user-1", ["roles.read.system"]),
      logger: false
    });

    const response = await app.inject({ method: "GET", url: "/backoffice/permissions" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "weights.read.self",
          category: "weights",
          categoryLabel: "Weight Tracking"
        }),
        expect.objectContaining({
          code: "backups.create.system",
          category: "backups",
          categoryLabel: "Backups"
        })
      ])
    );
    await app.close();
  });

  it("creates roles with selected permissions", async () => {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const role = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Care Team",
      description: "Can view records",
      isSystem: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
      permissions: [
        {
          permission: {
            id: "permission-1",
            code: "records.read.any",
            category: "records",
            categoryLabel: "Records",
            action: "read",
            scope: "any",
            label: "View any user records",
            createdAt,
            updatedAt: createdAt
          }
        }
      ]
    };
    const prisma = mockPrisma({
      role: {
        create: vi.fn().mockResolvedValue({ id: role.id }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(role)
      },
      permission: {
        findMany: vi.fn().mockResolvedValue([{ id: "permission-1" }])
      },
      rolePermission: {
        deleteMany: vi.fn(),
        createMany: vi.fn()
      }
    } as unknown as Partial<AppPrisma>);
    const app = await buildApp({
      config,
      prisma,
      authenticate: mockAuth("user-1", ["roles.create.system"]),
      logger: false
    });

    const response = await app.inject({
      method: "POST",
      url: "/backoffice/roles",
      payload: {
        name: "Care Team",
        description: "Can view records",
        permissions: ["records.read.any"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: role.id,
      name: "Care Team",
      permissions: [expect.objectContaining({ code: "records.read.any" })]
    });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: role.id, permissionId: "permission-1" }],
      skipDuplicates: true
    });
    await app.close();
  });

  it("assigns roles to users from backoffice", async () => {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const role = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Care Team",
      description: null,
      isSystem: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
      permissions: []
    };
    const user = {
      id: "44444444-4444-4444-8444-444444444444",
      email: "patient@example.com",
      name: "Patient",
      createdAt,
      profile: null,
      roles: [{ role }]
    };
    const prisma = mockPrisma({
      role: {
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn().mockResolvedValue({ id: "admin-role-id" })
      },
      userRole: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(2),
        deleteMany: vi.fn(),
        createMany: vi.fn()
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(user)
      }
    } as unknown as Partial<AppPrisma>);
    const app = await buildApp({
      config,
      prisma,
      authenticate: mockAuth("user-1", ["users.assignRoles.system"]),
      logger: false
    });

    const response = await app.inject({
      method: "PUT",
      url: `/backoffice/users/${user.id}/roles`,
      payload: { roleIds: [role.id] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: user.id,
      roles: [expect.objectContaining({ id: role.id, name: "Care Team" })]
    });
    expect(prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: user.id, roleId: role.id }],
      skipDuplicates: true
    });
    await app.close();
  });
});
