import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KeycloakAuthService } from "./keycloak.js";
import type { PasswordResetService } from "./password-reset.js";

const emailSchema = z.string().email().transform((value) => value.toLowerCase());

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional()
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1)
});

const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const forgotPasswordRequestSchema = z.object({
  email: emailSchema
});

const forgotPasswordConfirmSchema = z.object({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8)
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  keycloakAuth: KeycloakAuthService,
  passwordReset: PasswordResetService
): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const token = await keycloakAuth.register(body);
    reply.status(201);
    return token;
  });

  app.post("/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    return keycloakAuth.login(body);
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (request) => request.user);

  app.post("/auth/password/reset", { preHandler: app.authenticate }, async (request) => {
    const body = resetPasswordSchema.parse(request.body);
    await passwordReset.resetPassword({
      keycloakId: request.user.keycloakId,
      email: request.user.email,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword
    });
    return { message: "Password has been reset" };
  });

  app.post("/auth/password/forgot/request", async (request) => {
    const body = forgotPasswordRequestSchema.parse(request.body);
    return passwordReset.requestForgotPassword(body.email);
  });

  app.post("/auth/password/forgot/confirm", async (request) => {
    const body = forgotPasswordConfirmSchema.parse(request.body);
    await passwordReset.confirmForgotPassword(body);
    return { message: "Password has been reset" };
  });
}
