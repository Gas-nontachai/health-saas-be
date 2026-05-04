import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import { HttpError } from "../shared/errors.js";

export type Mailer = {
  sendPasswordResetOtp(email: string, otp: string): Promise<void>;
};

export function createSmtpMailer(config: AppConfig): Mailer {
  return {
    async sendPasswordResetOtp(email, otp) {
      assertSmtpConfig(config);

      const transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth:
          config.SMTP_USER && config.SMTP_PASSWORD
            ? {
                user: config.SMTP_USER,
                pass: config.SMTP_PASSWORD
              }
            : undefined
      });

      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: "Blood Sugar password reset OTP",
        text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your password reset OTP is <strong>${otp}</strong>.</p><p>It expires in 10 minutes.</p>`
      });
    }
  };
}

function assertSmtpConfig(config: AppConfig): asserts config is AppConfig & {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_FROM: string;
} {
  if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM) {
    throw new HttpError(500, "SMTP configuration is missing");
  }
}
