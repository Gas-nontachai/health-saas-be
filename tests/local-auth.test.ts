import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppConfig } from "../src/config/index.js";
import type { AppPrisma } from "../src/infra/prisma.js";
import { createLocalAuthService } from "../src/modules/identity/auth/local.js";
import { hashPassword, verifyPassword } from "../src/modules/identity/auth/passwords.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/blood_sugar",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-for-local-auth",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  KEYCLOAK_USER_MIGRATION_ON_DEPLOY: false,
  KEYCLOAK_USER_MIGRATION_FORCE_EMAIL: false,
  RESET_OTP_SECRET: "test-reset-otp-secret-that-is-long-enough",
  INITIAL_ADMIN_BOOTSTRAP_ON_START: false,
  RBAC_SYNC_ON_START: false
};

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    keycloakId: null,
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
    }
  } as unknown as AppPrisma;
}

describe("local auth service", () => {
  it("adds local auth migration fields and keeps legacy Keycloak mapping optional", () => {
    const migration = readFileSync("prisma/migrations/20260606000000_local_auth_migration/migration.sql", "utf8");
    expect(migration).toContain('"passwordHash"');
    expect(migration).toContain('"passwordChangeRequired"');
    expect(migration).toContain('"temporaryPasswordSentAt"');
    expect(migration).toContain('ALTER COLUMN "keycloakId" DROP NOT NULL');
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

    expect(response.access_token).toEqual(expect.any(String));
    expect(response.refresh_token).toEqual(expect.any(String));
    expect(response.requiresPasswordChange).toBe(true);
    expect(response.user.permissions).toEqual(["auth.read.self"]);
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
});
