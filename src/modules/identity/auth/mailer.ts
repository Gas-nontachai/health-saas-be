import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { HttpError } from "../../../common/errors.js";

export type SmtpMailerConfig = {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_TIMEOUT_MS?: number;
};

export type Mailer = {
  sendPasswordResetOtp(email: string, otp: string): Promise<void>;
  sendTemporaryPassword(email: string, temporaryPassword: string): Promise<void>;
};

export function createSmtpMailer(config: SmtpMailerConfig): Mailer {
  const sendMail = async (input: { to: string; subject: string; text: string; html: string }) => {
    assertSmtpConfig(config);

    const transportOptions: SMTPTransport.Options = {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      connectionTimeout: config.SMTP_TIMEOUT_MS ?? 10_000,
      greetingTimeout: config.SMTP_TIMEOUT_MS ?? 10_000,
      socketTimeout: config.SMTP_TIMEOUT_MS ?? 10_000,
      auth:
        config.SMTP_USER && config.SMTP_PASSWORD
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASSWORD
            }
          : undefined
    };
    Object.assign(transportOptions, { family: 4 });
    const transporter = nodemailer.createTransport(transportOptions);

    await transporter.sendMail({
      from: config.SMTP_FROM,
      ...input
    });
  };

  return {
    async sendPasswordResetOtp(email, otp) {
      await sendMail({
        to: email,
        subject: "Blood Sugar password reset OTP",
        text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your password reset OTP is <strong>${otp}</strong>.</p><p>It expires in 10 minutes.</p>`
      });
    },

    async sendTemporaryPassword(email, temporaryPassword) {
      await sendMail({
        to: email,
        subject: "Health SaaS account migration",
        text: `Your account has been migrated. Sign in with ${email} and this temporary password: ${temporaryPassword}. You must change it after first login.`,
        html: `<p>Your account has been migrated.</p><p>Sign in with <strong>${email}</strong> and this temporary password: <strong>${temporaryPassword}</strong>.</p><p>You must change it after first login.</p>`
      });
    }
  };
}

function assertSmtpConfig(config: SmtpMailerConfig): asserts config is SmtpMailerConfig & {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_FROM: string;
} {
  if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM) {
    throw new HttpError(500, "SMTP configuration is missing");
  }
}
