import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppConfig } from "../src/config/index.js";
import type { AppPrisma } from "../src/infra/prisma.js";
import { createLocalAuthService, hashRefreshToken } from "../src/modules/identity/auth/local.js";
import { hashPassword, verifyPassword } from "../src/modules/identity/auth/passwords.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/blood_sugar",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-for-local-auth",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  AUTH_ALLOWED_ORIGINS: "http://localhost:5173",
  AUTH_REFRESH_COOKIE_NAME: "refresh_token",
  AUTH_REFRESH_COOKIE_PATH: "/auth",
  AUTH_REFRESH_COOKIE_SAME_SITE: "lax",
  AUTH_REFRESH_COOKIE_SECURE: false,
  AUTH_LEGACY_JSON_REFRESH_ENABLED: true,
  AUTH_SESSION_CLEANUP_RETENTION_SECONDS: 604800,
  RESET_OTP_SECRET: "test-reset-otp-secret-that-is-long-enough",
  INITIAL_ADMIN_BOOTSTRAP_ON_START: false,
  RBAC_SYNC_ON_START: false,
  BACKUP_CRON_SECRET: "test-backup-secret",
  BACKUP_TEMP_DIR: "/tmp/backups",
  BACKUP_ENVIRONMENT: "test",
  BACKUP_INCLUDE_EXCEL: true,
  BACKUP_INCLUDE_SQL: true
};

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    passwordHash: null,
    passwordChangeRequired: false,
    passwordChangedAt: null,
    migratedFrom: null,
    migratedAt: null,
    temporaryPasswordSentAt: null,
    createdAt: new Date(),
    ...overrides
  };
}

function mockPrisma(user: ReturnType<typeof mockUser>): AppPrisma {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findUniqueOrThrow: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...user, ...data }))
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([
        {
          role: {
            name: "User",
            permissions: [{ permission: { code: "auth.read.self" } }]
          }
        }
      ])
    },
    refreshSession: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    }
  } as unknown as AppPrisma;
}

describe("local auth service", () => {
  it("adds local auth migration fields", () => {
    const migration = readFileSync("prisma/migrations/20260606000000_local_auth_migration/migration.sql", "utf8");
    expect(migration).toContain('"passwordHash"');
    expect(migration).toContain('"passwordChangeRequired"');
    expect(migration).toContain('"temporaryPasswordSentAt"');
    expect(migration).toContain('CREATE UNIQUE INDEX "User_email_key"');
  });

  it("hashes and verifies passwords", async () => {
    const passwordHash = await hashPassword("password123");
    expect(passwordHash).toMatch(/^scrypt:/);
    expect(await verifyPassword("password123", passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", passwordHash)).toBe(false);
  });

  it("logs in local users and includes password change state", async () => {
    const user = mockUser({ passwordHash: await hashPassword("password123"), passwordChangeRequired: true });
    const service = createLocalAuthService(config, mockPrisma(user));

    const response = await service.login({ email: "USER@example.com", password: "password123" });

    expect(response.response.access_token).toEqual(expect.any(String));
    expect(response.refreshToken).toEqual(expect.any(String));
    expect(response.response.requiresPasswordChange).toBe(true);
    expect(response.response.user.permissions).toEqual(["auth.read.self"]);
  });

  it("rejects invalid login passwords", async () => {
    const user = mockUser({ passwordHash: await hashPassword("password123") });
    const service = createLocalAuthService(config, mockPrisma(user));

    await expect(service.login({ email: "user@example.com", password: "wrong" })).rejects.toThrow("Invalid email or password");
  });

  it("resets passwords without clearing force-change state", async () => {
    const user = mockUser({ passwordHash: await hashPassword("password123"), passwordChangeRequired: true });
    const prisma = mockPrisma(user);
    const service = createLocalAuthService(config, prisma);

    await service.resetPassword({ userId: "user-1", currentPassword: "password123", newPassword: "new-password" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.stringMatching(/^scrypt:/),
        passwordChangedAt: expect.any(Date),
        passwordChangeRequired: true
      }
    });
  });

  it("clears force-change state after required password change", async () => {
    const user = mockUser({ passwordHash: await hashPassword("temporary"), passwordChangeRequired: true });
    const prisma = mockPrisma(user);
    const service = createLocalAuthService(config, prisma);

    await service.changeRequiredPassword({ userId: "user-1", currentPassword: "temporary", newPassword: "new-password" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.stringMatching(/^scrypt:/),
        passwordChangedAt: expect.any(Date),
        passwordChangeRequired: false
      }
    });
  });

  it("stores only a SHA-256 refresh token hash", async () => {
    const user = mockUser({ passwordHash: await hashPassword("password123") });
    const prisma = mockPrisma(user);
    const service = createLocalAuthService(config, prisma);
    const result = await service.login({ email: user.email, password: "password123" });

    expect(prisma.refreshSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenHash: hashRefreshToken(result.refreshToken) }) });
    expect(prisma.refreshSession.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ tokenHash: result.refreshToken }) });
  });

  it("rotates refresh tokens once and revokes the family on reuse", async () => {
    const user = mockUser();
    const sessions: Array<Record<string, any>> = [];
    const refreshSession = {
      create: vi.fn(async ({ data }) => {
        const row = { id: `session-${sessions.length + 1}`, usedAt: null, revokedAt: null, createdAt: new Date(), ...data };
        sessions.push(row);
        return row;
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn(async ({ where, data }) => {
        const matching = sessions.filter((row) =>
          (!where.tokenHash || row.tokenHash === where.tokenHash) &&
          (!where.familyId || row.familyId === where.familyId) &&
          (where.usedAt !== null || row.usedAt === null) &&
          (where.revokedAt !== null || row.revokedAt === null) &&
          (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt)
        );
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      }),
      findUnique: vi.fn(async ({ where }) => sessions.find((row) => row.tokenHash === where.tokenHash) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }) => {
        const row = sessions.find((item) => item.tokenHash === where.tokenHash);
        if (!row) throw new Error("missing session");
        return row;
      })
    };
    const prisma = mockPrisma(user) as any;
    prisma.refreshSession = refreshSession;
    prisma.$transaction = vi.fn(async (callback: (tx: AppPrisma) => Promise<unknown>) => callback(prisma));
    const service = createLocalAuthService(config, prisma);
    const raw = "secure-random-refresh-token";
    await refreshSession.create({ data: { userId: user.id, familyId: "family-1", tokenHash: hashRefreshToken(raw), expiresAt: new Date(Date.now() + 60_000) } });

    const rotated = await service.refreshToken(raw);
    expect("refreshToken" in rotated && rotated.refreshToken).not.toBe(raw);
    expect(sessions).toHaveLength(2);

    const reused = await service.refreshToken(raw);
    expect(reused).toEqual({ reuseDetected: true });
    expect(sessions.every((session) => session.revokedAt instanceof Date)).toBe(true);
  });

  it("rejects expired refresh sessions", async () => {
    const user = mockUser();
    const session = { id: "expired", userId: user.id, familyId: "family", tokenHash: hashRefreshToken("expired-token"), expiresAt: new Date(Date.now() - 1000), usedAt: null, revokedAt: null };
    const prisma = mockPrisma(user) as any;
    prisma.refreshSession = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(session)
    };
    prisma.$transaction = vi.fn(async (callback: (tx: AppPrisma) => Promise<unknown>) => callback(prisma));
    const service = createLocalAuthService(config, prisma);

    await expect(service.refreshToken("expired-token")).rejects.toThrow("Invalid or expired refresh session");
  });
});
