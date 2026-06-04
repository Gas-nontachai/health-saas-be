import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../infra/prisma.js";
import { requirePermission } from "../identity/rbac/authorize.js";
import { PERMISSIONS } from "../identity/rbac/permissions.js";
import {
  createRoleSchema,
  idParamsSchema,
  updateRoleSchema,
  updateUserProfileSchema,
  updateUserRolesSchema,
  usersQuerySchema
} from "./schemas.js";
import {
  createBackofficeRole,
  deleteBackofficeRole,
  getBackofficeRole,
  getBackofficeUser,
  listRoles,
  listUsers,
  updateBackofficeRole,
  updateBackofficeUserProfile,
  updateBackofficeUserRoles
} from "./service.js";

export async function registerBackofficeRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/backoffice/permissions", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async () => ({ data: PERMISSIONS }));

  app.get("/backoffice/roles", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async () => listRoles(prisma));

  app.post("/backoffice/roles", { preHandler: [app.authenticate, requirePermission("roles.create.system")] }, async (request, reply) => {
    const body = createRoleSchema.parse(request.body);
    const role = await createBackofficeRole(prisma, body);
    reply.status(201);
    return role;
  });

  app.get("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    return getBackofficeRole(prisma, params.id);
  });

  app.put("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.update.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    return updateBackofficeRole(prisma, params.id, body);
  });

  app.delete("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.delete.system")] }, async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    await deleteBackofficeRole(prisma, params.id);
    reply.status(204).send();
  });

  app.get("/backoffice/users", { preHandler: [app.authenticate, requirePermission("users.read.system")] }, async (request) => {
    const query = usersQuerySchema.parse(request.query);
    return listUsers(prisma, query);
  });

  app.get("/backoffice/users/:id", { preHandler: [app.authenticate, requirePermission("users.read.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    return getBackofficeUser(prisma, params.id);
  });

  app.put("/backoffice/users/:id/profile", { preHandler: [app.authenticate, requirePermission("users.update.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateUserProfileSchema.parse(request.body);
    return updateBackofficeUserProfile(prisma, params.id, body);
  });

  app.put("/backoffice/users/:id/roles", { preHandler: [app.authenticate, requirePermission("users.assignRoles.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateUserRolesSchema.parse(request.body);
    return updateBackofficeUserRoles(prisma, params.id, body.roleIds);
  });
}
