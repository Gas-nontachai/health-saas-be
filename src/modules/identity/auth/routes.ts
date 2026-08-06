import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../../../config/index.js";
import { HttpError } from "../../../common/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import type { AuthResult, LocalAuthService } from "./local.js";
import type { PasswordResetService } from "./password-reset.js";
import { changeRequiredPasswordSchema, forgotPasswordConfirmSchema, forgotPasswordRequestSchema, loginSchema, legacyRefreshTokenSchema, registerSchema, resetPasswordSchema } from "./schemas.js";

const COOKIE_CONTRACT_HEADER = "cookie-v1";

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig, localAuth: LocalAuthService, passwordReset: PasswordResetService): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const result = await localAuth.register(registerSchema.parse(request.body));
    setRefreshCookie(reply, config, result.refreshToken);
    reply.status(201);
    return authResponse(request, config, result);
  });

  app.post("/auth/login", async (request, reply) => {
    const result = await localAuth.login(loginSchema.parse(request.body));
    setRefreshCookie(reply, config, result.refreshToken);
    return authResponse(request, config, result);
  });

  app.get("/auth/me", { preHandler: [app.authenticate, requirePermission("auth.read.self")] }, async (request) => request.user);

  app.post("/auth/refresh", { preHandler: [originGuard(config)] }, async (request, reply) => {
    const cookieToken = request.cookies[config.AUTH_REFRESH_COOKIE_NAME];
    const useCookieContract = request.headers["x-auth-contract"] === COOKIE_CONTRACT_HEADER || !config.AUTH_LEGACY_JSON_REFRESH_ENABLED;
    let token = cookieToken;
    let legacyStateless = false;
    if (!token && !useCookieContract && config.AUTH_LEGACY_JSON_REFRESH_ENABLED) {
      token = legacyRefreshTokenSchema.parse(request.body).refreshToken;
      legacyStateless = token.includes(".");
    }
    if (!token) return unauthorizedAndClear(reply, config, "Refresh cookie is required");
    try {
      const result = legacyStateless ? await localAuth.refreshLegacyToken(token) : await localAuth.refreshToken(token);
      if ("reuseDetected" in result) return unauthorizedAndClear(reply, config, "Refresh token reuse detected");
      setRefreshCookie(reply, config, result.refreshToken);
      return useCookieContract ? result.response : { ...result.response, refresh_token: result.refreshToken };
    } catch (error) {
      clearRefreshCookie(reply, config);
      throw error;
    }
  });

  app.post("/auth/logout", { preHandler: [originGuard(config)] }, async (request, reply) => {
    const token = request.cookies[config.AUTH_REFRESH_COOKIE_NAME];
    try { if (token) await localAuth.logout(token); } finally { clearRefreshCookie(reply, config); }
    return { message: "Logged out" };
  });

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

function authResponse(request: FastifyRequest, config: AppConfig, result: AuthResult) {
  const cookieContract = request.headers["x-auth-contract"] === COOKIE_CONTRACT_HEADER || !config.AUTH_LEGACY_JSON_REFRESH_ENABLED;
  return cookieContract ? result.response : { ...result.response, refresh_token: result.refreshToken };
}

function cookieOptions(config: AppConfig) {
  return { httpOnly: true, secure: config.AUTH_REFRESH_COOKIE_SECURE, sameSite: config.AUTH_REFRESH_COOKIE_SAME_SITE, path: config.AUTH_REFRESH_COOKIE_PATH, domain: config.AUTH_REFRESH_COOKIE_DOMAIN, maxAge: config.REFRESH_TOKEN_TTL_SECONDS } as const;
}
function setRefreshCookie(reply: FastifyReply, config: AppConfig, token: string): void { reply.setCookie(config.AUTH_REFRESH_COOKIE_NAME, token, cookieOptions(config)); }
function clearRefreshCookie(reply: FastifyReply, config: AppConfig): void { reply.clearCookie(config.AUTH_REFRESH_COOKIE_NAME, cookieOptions(config)); }
function unauthorizedAndClear(reply: FastifyReply, config: AppConfig, message: string) { clearRefreshCookie(reply, config); return reply.status(401).send({ ok: false, error: message }); }

function originGuard(config: AppConfig) {
  const allowed = new Set(parseAllowedOrigins(config.AUTH_ALLOWED_ORIGINS));
  return async (request: FastifyRequest) => {
    const candidate = request.headers.origin ?? originFromReferer(request.headers.referer);
    if (!candidate || !allowed.has(candidate)) throw new HttpError(403, "Origin is not allowed");
  };
}
export function parseAllowedOrigins(value: string): string[] { return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => new URL(item).origin); }
function originFromReferer(referer?: string): string | undefined { try { return referer ? new URL(referer).origin : undefined; } catch { return undefined; } }
