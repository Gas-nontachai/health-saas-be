import type { FastifyReply, FastifyRequest } from "fastify";
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
    resetPassword: vi.fn(),
    findUserByEmail: vi.fn(),
    setPassword: vi.fn()
  };
}

function mockPasswordReset() {
  return {
    resetPassword: vi.fn(),
    requestForgotPassword: vi.fn().mockResolvedValue({ message: "If the email exists, an OTP has been sent" }),
    confirmForgotPassword: vi.fn()
  };
}

describe("app", () => {
  afterEach(() => {
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

  it("rejects invalid blood sugar values", async () => {
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/records",
      payload: {
        datetime: "2026-05-01T10:00:00.000Z",
        bloodSugar: 601
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false });
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
    expect(response.json()).toEqual({
      avg: 120,
      min: 80,
      max: 180,
      trend: [{ datetime: "2026-05-01T10:00:00.000Z", value: 120 }]
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
    expect(prisma.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        take: 1000
      })
    );
    await app.close();
  });

  it("exports excel workbooks", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.record.findMany).mockResolvedValue([
      {
        id: "record-1",
        userId: "user-1",
        datetime: new Date("2026-05-01T10:00:00.000Z"),
        bloodSugar: 120,
        medMorning: 1,
        medEvening: null,
        note: "before breakfast",
        createdAt: new Date()
      }
    ]);
    const app = await buildApp({ config, prisma, authenticate: mockAuth("user-1"), logger: false });

    const response = await app.inject({ method: "GET", url: "/export?type=excel" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(response.rawPayload.length).toBeGreaterThan(0);
    await app.close();
  });
});
