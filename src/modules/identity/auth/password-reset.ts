import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../../config/index.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import type { Mailer } from "./mailer.js";
import { hashPassword } from "./passwords.js";

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const FORGOT_PASSWORD_MESSAGE = "If the email exists, an OTP has been sent";

export type PasswordResetService = {
  requestForgotPassword(email: string): Promise<{ message: string }>;
  confirmForgotPassword(input: { email: string; otp: string; newPassword: string }): Promise<void>;
};

export function createPasswordResetService(config: AppConfig, prisma: AppPrisma, mailer: Mailer): PasswordResetService {
  return {
    async requestForgotPassword(email) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return { message: FORGOT_PASSWORD_MESSAGE };
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      await prisma.passwordResetOtp.create({
        data: {
          email,
          otpHash: hashOtp(config, email, otp),
          expiresAt
        }
      });

      await mailer.sendPasswordResetOtp(email, otp);
      return { message: FORGOT_PASSWORD_MESSAGE };
    },

    async confirmForgotPassword(input) {
      const otpRecord = await prisma.passwordResetOtp.findFirst({
        where: {
          email: input.email,
          consumedAt: null
        },
        orderBy: { createdAt: "desc" }
      });

      if (!otpRecord || otpRecord.expiresAt <= new Date() || otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
        throw new HttpError(400, "Invalid or expired OTP");
      }

      const expectedHash = hashOtp(config, input.email, input.otp);
      if (!safeEqual(otpRecord.otpHash, expectedHash)) {
        await prisma.passwordResetOtp.update({
          where: { id: otpRecord.id },
          data: { attempts: { increment: 1 } }
        });
        throw new HttpError(400, "Invalid or expired OTP");
      }

      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        throw new HttpError(400, "Invalid or expired OTP");
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(input.newPassword),
          passwordChangeRequired: false,
          passwordChangedAt: new Date()
        }
      });
      await prisma.passwordResetOtp.update({
        where: { id: otpRecord.id },
        data: { consumedAt: new Date() }
      });
    }
  };
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashOtp(config: AppConfig, email: string, otp: string): string {
  if (!config.RESET_OTP_SECRET) {
    throw new HttpError(500, "RESET_OTP_SECRET configuration is missing");
  }

  return createHmac("sha256", config.RESET_OTP_SECRET).update(`${email.toLowerCase()}:${otp}`).digest("hex");
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}
