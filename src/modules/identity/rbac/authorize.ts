import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";

export type AuthzUser = {
  id: string;
  email: string;
  name?: string | null;
  roles: string[];
  permissions: string[];
  passwordChangeRequired?: boolean;
};

export function requirePermission(permission: string): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user.permissions.includes(permission)) {
      throw new HttpError(403, `Permission denied: ${permission}`);
    }
  };
}

export function composePreHandlers(...handlers: preHandlerHookHandler[]): preHandlerHookHandler[] {
  return handlers;
}

export async function getUserRolePermissions(prisma: AppPrisma, userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId,
      role: { isActive: true }
    },
    select: {
      role: {
        select: {
          name: true,
          permissions: {
            select: {
              permission: {
                select: { code: true }
              }
            }
          }
        }
      }
    }
  });

  const roles = userRoles.map((userRole) => userRole.role.name).sort();
  const permissions = [
    ...new Set(userRoles.flatMap((userRole) => userRole.role.permissions.map((rolePermission) => rolePermission.permission.code)))
  ].sort();

  return { roles, permissions };
}
