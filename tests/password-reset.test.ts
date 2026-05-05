import { describe, expect, it, vi } from "vitest";
import { createPasswordResetService } from "../src/auth/password-reset.js";
import type { AppConfig } from "../src/config.js";
import type { AppPrisma } from "../src/prisma.js";

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

function mockPrisma(): AppPrisma {
  return {
    passwordResetOtp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    }
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

describe("password reset service", () => {
  it("does not reveal missing emails during forgot password request", async () => {
    const prisma = mockPrisma();
    const keycloakAuth = mockKeycloakAuth();
    keycloakAuth.findUserByEmail.mockResolvedValue(null);
    const mailer = { sendPasswordResetOtp: vi.fn() };
    const service = createPasswordResetService(config, prisma, keycloakAuth, mailer);

    const response = await service.requestForgotPassword("missing@example.com");

    expect(response).toEqual({ message: "If the email exists, an OTP has been sent" });
    expect(prisma.passwordResetOtp.create).not.toHaveBeenCalled();
    expect(mailer.sendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it("creates OTP hashes and sends mail for known emails", async () => {
    const prisma = mockPrisma();
    const keycloakAuth = mockKeycloakAuth();
    keycloakAuth.findUserByEmail.mockResolvedValue({ id: "kc-user-1", email: "user@example.com" });
    const mailer = { sendPasswordResetOtp: vi.fn() };
    const service = createPasswordResetService(config, prisma, keycloakAuth, mailer);

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
    const service = createPasswordResetService(config, prisma, mockKeycloakAuth(), { sendPasswordResetOtp: vi.fn() });

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
    const keycloakAuth = mockKeycloakAuth();
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-1",
      email: "user@example.com",
      otpHash: "hash",
      expiresAt: new Date(Date.now() - 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date()
    });
    const service = createPasswordResetService(config, prisma, keycloakAuth, { sendPasswordResetOtp: vi.fn() });

    await expect(
      service.confirmForgotPassword({
        email: "user@example.com",
        otp: "123456",
        newPassword: "new-password"
      })
    ).rejects.toThrow("Invalid or expired OTP");

    expect(keycloakAuth.setPassword).not.toHaveBeenCalled();
    expect(prisma.passwordResetOtp.update).not.toHaveBeenCalled();
  });

  it("resets passwords and consumes valid OTPs", async () => {
    const prisma = mockPrisma();
    const keycloakAuth = mockKeycloakAuth();
    keycloakAuth.findUserByEmail.mockResolvedValue({ id: "kc-user-1", email: "user@example.com" });
    const service = createPasswordResetService(config, prisma, keycloakAuth, { sendPasswordResetOtp: vi.fn() });

    await service.requestForgotPassword("user@example.com");
    const createCall = vi.mocked(prisma.passwordResetOtp.create).mock.calls[0]?.[0];
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-1",
      email: "user@example.com",
      otpHash: createCall.data.otpHash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date()
    });
    const otp = vi.mocked(keycloakAuth.findUserByEmail).mock.results.length ? vi.mocked(prisma.passwordResetOtp.create).mock.calls[0] : undefined;
    const sentOtp = vi.fn();
    expect(otp).toBeDefined();

    const mailer = {
      sendPasswordResetOtp: sentOtp
    };
    const serviceWithMailer = createPasswordResetService(config, prisma, keycloakAuth, mailer);
    await serviceWithMailer.requestForgotPassword("user@example.com");
    const deliveredOtp = sentOtp.mock.calls[0]?.[1] as string;
    const secondCreateCall = vi.mocked(prisma.passwordResetOtp.create).mock.calls.at(-1)?.[0];
    expect(secondCreateCall).toBeDefined();
    vi.mocked(prisma.passwordResetOtp.findFirst).mockResolvedValue({
      id: "otp-2",
      email: "user@example.com",
      otpHash: secondCreateCall!.data.otpHash,
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

    expect(keycloakAuth.setPassword).toHaveBeenCalledWith("kc-user-1", "new-password");
    expect(prisma.passwordResetOtp.update).toHaveBeenCalledWith({
      where: { id: "otp-2" },
      data: { consumedAt: expect.any(Date) }
    });
  });
});
