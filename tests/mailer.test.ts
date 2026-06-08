import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendMailer } from "../src/modules/identity/auth/mailer.js";

describe("mailer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends password reset OTPs through Resend when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const mailer = createResendMailer({
      RESEND_API_KEY: "re_test",
      MAIL_FROM: "Health SaaS <no-reply@example.com>"
    });

    await mailer.sendPasswordResetOtp("user@example.com", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer re_test",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Health SaaS <no-reply@example.com>",
          to: ["user@example.com"],
          subject: "Blood Sugar password reset OTP",
          html: "<p>Your password reset OTP is <strong>123456</strong>.</p><p>It expires in 10 minutes.</p>",
          text: "Your password reset OTP is 123456. It expires in 10 minutes."
        }),
        signal: expect.any(AbortSignal)
      })
    );
  });
});
