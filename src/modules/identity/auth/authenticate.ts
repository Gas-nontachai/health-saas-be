import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppConfig } from "../../../config/index.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { getUserRolePermissions } from "../rbac/authorize.js";
import { HttpError } from "../../../common/errors.js";
import { verifyLocalToken } from "./local.js";

const PASSWORD_CHANGE_ALLOWED_ROUTES = new Set([
  "GET /auth/me",
  "POST /auth/password/change-required",
  "POST /auth/password/reset"
]);

export function createAuthenticate(config: AppConfig, prisma: AppPrisma): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length);
    const payload = await verifyLocalToken(config, token, "access");
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } });
    if (!user) throw new HttpError(401, "Invalid bearer token");

    const { roles, permissions } = await getUserRolePermissions(prisma, user.id);
    request.user = {
      id: user.id,
      keycloakId: user.keycloakId,
      email: user.email,
      name: user.name,
      roles,
      permissions,
      passwordChangeRequired: user.passwordChangeRequired
    };

    if (user.passwordChangeRequired && !isPasswordChangeAllowed(request)) {
      throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED");
    }
  };
}

function isPasswordChangeAllowed(request: FastifyRequest): boolean {
  return PASSWORD_CHANGE_ALLOWED_ROUTES.has(`${request.method} ${request.routeOptions.url}`);
}
