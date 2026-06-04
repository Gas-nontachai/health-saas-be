import type { FastifyInstance } from "fastify";
import { requirePermission } from "../rbac/authorize.js";
import type { LocalAuthService } from "./local.js";
import type { PasswordResetService } from "./password-reset.js";
import {
  changeRequiredPasswordSchema,
  forgotPasswordConfirmSchema,
  forgotPasswordRequestSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema
} from "./schemas.js";

export async function registerAuthRoutes(app: FastifyInstance, localAuth: LocalAuthService, passwordReset: PasswordResetService): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const token = await localAuth.register(registerSchema.parse(request.body));
    reply.status(201);
    return token;
  });

  app.post("/auth/login", async (request) => localAuth.login(loginSchema.parse(request.body)));
  app.get("/auth/me", { preHandler: [app.authenticate, requirePermission("auth.read.self")] }, async (request) => request.user);
  app.post("/auth/refresh", async (request) => localAuth.refreshToken(refreshTokenSchema.parse(request.body).refreshToken));

  app.post("/auth/password/reset", { preHandler: [app.authenticate, requirePermission("auth.reset.self")] }, async (request) => {
    const body = resetPasswordSchema.parse(request.body);
    await localAuth.resetPassword({ userId: request.user.id, currentPassword: body.currentPassword, newPassword: body.newPassword });
    return { message: "Password has been reset" };
  });

  app.post("/auth/password/change-required", { preHandler: [app.authenticate] }, async (request) => {
    const body = changeRequiredPasswordSchema.parse(request.body);
    await localAuth.changeRequiredPassword({ userId: request.user.id, currentPassword: body.currentPassword, newPassword: body.newPassword });
    return { message: "Password has been changed" };
  });

  app.post("/auth/password/forgot/request", async (request) => passwordReset.requestForgotPassword(forgotPasswordRequestSchema.parse(request.body).email));
  app.post("/auth/password/forgot/confirm", async (request) => {
    const body = forgotPasswordConfirmSchema.parse(request.body);
    await passwordReset.confirmForgotPassword(body);
    return { message: "Password has been reset" };
  });
}
