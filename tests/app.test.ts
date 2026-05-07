import type { FastifyReply, FastifyRequest } from "fastify";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { AppPrisma } from "../src/prisma.js";
import { HttpError } from "../src/shared/errors.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/blood_sugar",
  KEYCLOAK_BASE_URL: "http://localhost:8080",
  KEYCLOAK_REALM: "blood-sugar",
  KEYCLOAK_CLIENT_ID: "blood-sugar-api",
  KEYCLOAK_ADMIN_USERNAME: "admin",
  KEYCLOAK_ADMIN_PASSWORD: "admin",
  KEYCLOAK_JWKS_URL: "http://localhost:8080/realms/blood-sugar/protocol/openid-connect/certs",
  RESET_OTP_SECRET: "test-reset-otp-secret-that-is-long-enough"
};

function mockAuth(userId = "user-1") {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    request.user = {
      id: userId,
      keycloakId: "kc-1",
      email: "tester@example.com",
      name: "Tester"
    };
  };
}

function mockPrisma(overrides: Partial<AppPrisma> = {}): AppPrisma {
  return {
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
    passwordResetOtp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    ...overrides
  } as unknown as AppPrisma;
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

function mockPasswordReset() {
  return {
    resetPassword: vi.fn(),
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

  it("registers users through Keycloak and returns tokens", async () => {
    const keycloakAuth = mockKeycloakAuth();
    keycloakAuth.register.mockResolvedValue({
      access_token: "access-token",
      expires_in: 300,
      token_type: "Bearer"
    });
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), keycloakAuth, logger: false });

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
      token_type: "Bearer"
    });
    expect(keycloakAuth.register).toHaveBeenCalledWith({
      email: "tester@example.com",
      password: "password123",
      firstName: "Tester"
    });
    await app.close();
  });

  it("logs users in through Keycloak and returns tokens", async () => {
    const keycloakAuth = mockKeycloakAuth();
    keycloakAuth.login.mockResolvedValue({
      access_token: "access-token",
      expires_in: 300,
      refresh_token: "refresh-token",
      token_type: "Bearer"
    });
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), keycloakAuth, logger: false });

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
      token_type: "Bearer"
    });
    expect(keycloakAuth.login).toHaveBeenCalledWith({
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
    const passwordReset = mockPasswordReset();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), passwordReset, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { currentPassword: "old-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Password has been reset" });
    expect(passwordReset.resetPassword).toHaveBeenCalledWith({
      keycloakId: "kc-1",
      email: "tester@example.com",
      currentPassword: "old-password",
      newPassword: "new-password"
    });
    await app.close();
  });

  it("returns errors when current password verification fails", async () => {
    const passwordReset = mockPasswordReset();
    passwordReset.resetPassword.mockRejectedValue(new HttpError(401, "Invalid email or password"));
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("user-1"), passwordReset, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { currentPassword: "wrong-password", newPassword: "new-password" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: "Invalid email or password" });
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
      update: { dashboardWidgets: ["summary", "trend", "bmi"] },
      create: { userId: "user-1", dashboardWidgets: ["summary", "trend", "bmi"] }
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
    expect(response.rawPayload.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const summary = workbook.getWorksheet("Summary");
    const records = workbook.getWorksheet("Records");

    expect(summary?.getCell("B9").value).toBe(2);
    expect(summary?.getCell("B10").value).toBe(1);
    expect(summary?.getCell("B11").value).toBe(120);
    expect(records?.getCell("D2").value).toBe(0);
    expect(records?.getCell("E2").value).toBe("Not measured");
    expect(records?.getCell("E3").value).toBe("Normal");
    expect(records?.getCell("H2").value).toBe("วัดไม่ได้ อาหารเย็น");
    expect(records?.getCell("H2").alignment?.wrapText).toBe(true);
    expect(records?.getCell("H2").alignment?.vertical).toBe("top");
    await app.close();
  });
});
