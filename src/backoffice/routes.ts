import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KeycloakAuthService } from "../auth/keycloak.js";
import type { AppPrisma } from "../prisma.js";
import { requirePermission } from "../rbac/authorize.js";
import { isKnownPermissionCode, PERMISSIONS } from "../rbac/permissions.js";
import { ADMIN_ROLE_NAME, grantPermissionsToRole } from "../rbac/sync.js";
import { HttpError } from "../shared/errors.js";
import { idParamsSchema } from "../shared/validation.js";

const permissionCodesSchema = z.array(z.string().refine(isKnownPermissionCode, "Unknown permission code")).default([]);

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  permissions: permissionCodesSchema
});

const updateRoleSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
    permissions: permissionCodesSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const updateUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid())
});

const updateUserProfileSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    weight: z.number().positive().optional().nullable(),
    height: z.number().positive().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const usersQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export async function registerBackofficeRoutes(app: FastifyInstance, prisma: AppPrisma, keycloakAuth: KeycloakAuthService): Promise<void> {
  app.get("/backoffice/permissions", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async () => ({
    data: PERMISSIONS
  }));

  app.get("/backoffice/roles", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async () => {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: roleInclude
    });

    return { data: roles.map(serializeRole) };
  });

  app.post("/backoffice/roles", { preHandler: [app.authenticate, requirePermission("roles.create.system")] }, async (request, reply) => {
    const body = createRoleSchema.parse(request.body);
    const role = await prisma.role.create({
      data: {
        name: body.name,
        description: body.description,
        isActive: body.isActive
      }
    });

    await grantPermissionsToRole(prisma, role.id, body.permissions);

    reply.status(201);
    return serializeRole(await findRoleOrThrow(prisma, role.id));
  });

  app.get("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.read.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    return serializeRole(await findRoleOrThrow(prisma, params.id));
  });

  app.put("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.update.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    const role = await findRoleOrThrow(prisma, params.id);

    if (role.isSystem && body.name && body.name !== role.name) {
      throw new HttpError(400, "System role name cannot be changed");
    }

    if (role.name === ADMIN_ROLE_NAME) {
      if (body.isActive === false) throw new HttpError(400, "Admin role cannot be deactivated");
      if (body.permissions && (!body.permissions.includes("roles.update.system") || !body.permissions.includes("users.assignRoles.system"))) {
        throw new HttpError(400, "Admin role must keep role management permissions");
      }
    }

    await prisma.role.update({
      where: { id: params.id },
      data: {
        name: body.name,
        description: body.description,
        isActive: body.isActive
      }
    });

    if (body.permissions) {
      await grantPermissionsToRole(prisma, params.id, body.permissions);
    }

    return serializeRole(await findRoleOrThrow(prisma, params.id));
  });

  app.delete("/backoffice/roles/:id", { preHandler: [app.authenticate, requirePermission("roles.delete.system")] }, async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const role = await findRoleOrThrow(prisma, params.id);

    if (role.isSystem) {
      throw new HttpError(400, "System roles cannot be deleted");
    }

    await prisma.role.delete({ where: { id: params.id } });
    reply.status(204).send();
  });

  app.get("/backoffice/users", { preHandler: [app.authenticate, requirePermission("users.read.system")] }, async (request) => {
    const query = usersQuerySchema.parse(request.query);
    const users = await prisma.user.findMany({
      where: query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: "insensitive" } },
              { name: { contains: query.q, mode: "insensitive" } }
            ]
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: userInclude
    });

    return { data: users.map(serializeUser) };
  });

  app.get("/backoffice/users/:id", { preHandler: [app.authenticate, requirePermission("users.read.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    return serializeUser(await findUserOrThrow(prisma, params.id));
  });

  app.put("/backoffice/users/:id/profile", { preHandler: [app.authenticate, requirePermission("users.update.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateUserProfileSchema.parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: params.id }, select: { keycloakId: true, name: true } });
    const { firstName, lastName, email, ...profileData } = body;

    if (firstName !== undefined || lastName !== undefined || email !== undefined) {
      await keycloakAuth.updateUser({
        keycloakId: user.keycloakId,
        firstName,
        lastName,
        email
      });

      const updateData: { email?: string; name?: string } = {};
      if (email !== undefined) updateData.email = email;
      if (firstName !== undefined || lastName !== undefined) {
        const [currentFirst, ...rest] = (user.name ?? "").split(" ");
        updateData.name = `${firstName ?? currentFirst} ${lastName ?? rest.join(" ")}`.trim();
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({ where: { id: params.id }, data: updateData });
      }
    }

    await prisma.profile.upsert({
      where: { userId: params.id },
      update: profileData,
      create: { userId: params.id, weight: profileData.weight, height: profileData.height }
    });

    return serializeUser(await findUserOrThrow(prisma, params.id));
  });

  app.put("/backoffice/users/:id/roles", { preHandler: [app.authenticate, requirePermission("users.assignRoles.system")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateUserRolesSchema.parse(request.body);
    await assertRolesExist(prisma, body.roleIds);
    await assertNotRemovingLastAdmin(prisma, params.id, body.roleIds);

    await prisma.userRole.deleteMany({ where: { userId: params.id } });
    if (body.roleIds.length > 0) {
      await prisma.userRole.createMany({
        data: body.roleIds.map((roleId) => ({ userId: params.id, roleId })),
        skipDuplicates: true
      });
    }

    return serializeUser(await findUserOrThrow(prisma, params.id));
  });
}

const roleInclude = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

const userInclude = {
  profile: true,
  roles: {
    include: {
      role: {
        include: roleInclude
      }
    }
  }
} as const;

async function findRoleOrThrow(prisma: AppPrisma, id: string) {
  return prisma.role.findUniqueOrThrow({
    where: { id },
    include: roleInclude
  });
}

async function findUserOrThrow(prisma: AppPrisma, id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    include: userInclude
  });
}

async function assertRolesExist(prisma: AppPrisma, roleIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(roleIds)];
  const count = await prisma.role.count({ where: { id: { in: uniqueIds } } });
  if (count !== uniqueIds.length) {
    throw new HttpError(400, "One or more roles do not exist");
  }
}

async function assertNotRemovingLastAdmin(prisma: AppPrisma, userId: string, nextRoleIds: string[]): Promise<void> {
  const adminRole = await prisma.role.findUnique({
    where: { name: ADMIN_ROLE_NAME },
    select: { id: true }
  });
  if (!adminRole || nextRoleIds.includes(adminRole.id)) return;

  const currentAdminAssignment = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId, roleId: adminRole.id } },
    select: { userId: true }
  });
  if (!currentAdminAssignment) return;

  const adminCount = await prisma.userRole.count({
    where: { roleId: adminRole.id }
  });

  if (adminCount <= 1) {
    throw new HttpError(400, "Cannot remove the last admin user");
  }
}

function serializeRole(role: Awaited<ReturnType<typeof findRoleOrThrow>>) {
  const permissions = role.permissions
    .map((rolePermission) => rolePermission.permission)
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    permissions,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString()
  };
}

function serializeUser(user: Awaited<ReturnType<typeof findUserOrThrow>>) {
  const roles = user.roles.map((userRole) => serializeRole(userRole.role)).sort((a, b) => a.name.localeCompare(b.name));
  const permissions = [...new Set(roles.flatMap((role) => (role.isActive ? role.permissions.map((permission) => permission.code) : [])))].sort();

  return {
    id: user.id,
    keycloakId: user.keycloakId,
    email: user.email,
    name: user.name,
    profile: user.profile,
    roles,
    permissions,
    createdAt: user.createdAt.toISOString()
  };
}
