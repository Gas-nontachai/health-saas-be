import { HttpError } from "../../../common/errors.js";

export type ResendMailerConfig = {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_TIMEOUT_MS?: number;
};

export type Mailer = {
  sendPasswordResetOtp(email: string, otp: string): Promise<void>;
  sendTemporaryPassword(email: string, temporaryPassword: string): Promise<void>;
};

export function createResendMailer(config: ResendMailerConfig): Mailer {
  const sendMail = async (input: { to: string; subject: string; text: string; html: string }) => {
    assertResendConfig(config);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.MAIL_TIMEOUT_MS ?? 10_000);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: config.MAIL_FROM,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Resend error";
      throw new HttpError(500, `Failed to send email via Resend: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
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

function assertResendConfig(config: ResendMailerConfig): asserts config is ResendMailerConfig & {
  RESEND_API_KEY: string;
  MAIL_FROM: string;
} {
  if (!config.RESEND_API_KEY || !config.MAIL_FROM) {
    throw new HttpError(500, "Resend mail configuration is missing");
  }
}
