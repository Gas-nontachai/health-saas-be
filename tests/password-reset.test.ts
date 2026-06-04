import { describe, expect, it, vi } from "vitest";
import { createPasswordResetService } from "../src/modules/identity/auth/password-reset.js";
import type { AppConfig } from "../src/config/index.js";
import type { AppPrisma } from "../src/infra/prisma.js";

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
  RBAC_SYNC_ON_START: false,
  BACKUP_CRON_SECRET: "test-backup-secret",
  BACKUP_TEMP_DIR: "/tmp/backups",
  BACKUP_ENVIRONMENT: "test",
  BACKUP_INCLUDE_EXCEL: true,
  BACKUP_INCLUDE_SQL: true
};

function mockPrisma(): AppPrisma {
  return {
    passwordResetOtp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  } as unknown as AppPrisma;
}

function mockMailer() {
  return {
    sendPasswordResetOtp: vi.fn(),
    sendTemporaryPassword: vi.fn()
  };
}

describe("password reset service", () => {
  it("does not reveal missing emails during forgot password request", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const mailer = mockMailer();
    const service = createPasswordResetService(config, prisma, mailer);

    const response = await service.requestForgotPassword("missing@example.com");

    expect(response).toEqual({ message: "If the email exists, an OTP has been sent" });
    expect(prisma.passwordResetOtp.create).not.toHaveBeenCalled();
    expect(mailer.sendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it("creates OTP hashes and sends mail for known emails", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", email: "user@example.com" } as never);
    const mailer = mockMailer();
    const service = createPasswordResetService(config, prisma, mailer);

    await service.requestForgotPassword("user@example.com");

    expect(prisma.passwordResetOtp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "user@example.com",
        otpHash: expect.any(String),
        expiresAt: expect.any(Date)
      })
    });
    expect(mailer.sendPasswordResetOtp).toHaveBeenCalledWith("user@example.com", expect.stringMatching(/^\d{6}$/));
  });

  it("increments attempts for wrong OTPs", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-1",
      email: "user@example.com",
      otpHash: "wrong-hash-with-same-length-123456789012",
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date()
    });
    const service = createPasswordResetService(config, prisma, mockMailer());

    await expect(
      service.confirmForgotPassword({
        email: "user@example.com",
        otp: "123456",
        newPassword: "new-password"
      })
    ).rejects.toThrow("Invalid or expired OTP");

    expect(prisma.passwordResetOtp.update).toHaveBeenCalledWith({
      where: { id: "otp-1" },
      data: { attempts: { increment: 1 } }
    });
  });

  it("rejects expired OTPs without resetting passwords", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-1",
      email: "user@example.com",
      otpHash: "hash",
      expiresAt: new Date(Date.now() - 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date()
    });
    const service = createPasswordResetService(config, prisma, mockMailer());

    await expect(
      service.confirmForgotPassword({
        email: "user@example.com",
        otp: "123456",
        newPassword: "new-password"
      })
    ).rejects.toThrow("Invalid or expired OTP");

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.passwordResetOtp.update).not.toHaveBeenCalled();
  });

  it("resets passwords and consumes valid OTPs", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", email: "user@example.com" } as never);
    const mailer = mockMailer();
    const serviceWithMailer = createPasswordResetService(config, prisma, mailer);
    await serviceWithMailer.requestForgotPassword("user@example.com");
    const deliveredOtp = mailer.sendPasswordResetOtp.mock.calls[0]?.[1] as string;
    const createCall = vi.mocked(prisma.passwordResetOtp.create).mock.calls[0]?.[0];
    expect(createCall).toBeDefined();
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-2",
      email: "user@example.com",
      otpHash: createCall!.data.otpHash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date()
    });

    await serviceWithMailer.confirmForgotPassword({
      email: "user@example.com",
      otp: deliveredOtp,
      newPassword: "new-password"
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.stringMatching(/^scrypt:/),
        passwordChangeRequired: false,
        passwordChangedAt: expect.any(Date)
      }
    });
    expect(prisma.passwordResetOtp.update).toHaveBeenCalledWith({
      where: { id: "otp-2" },
      data: { consumedAt: expect.any(Date) }
    });
  });
});
