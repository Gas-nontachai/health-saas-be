import type { AppPrisma } from "../../infra/prisma.js";
import type { CreateRoleInput, UpdateRoleInput, UsersQuery } from "./schemas.js";

export const roleInclude = { permissions: { include: { permission: true } } } as const;

export const userInclude = {
  profile: true,
  roles: { include: { role: { include: roleInclude } } }
} as const;

export async function findRoles(prisma: AppPrisma) {
  return prisma.role.findMany({ orderBy: { name: "asc" }, include: roleInclude });
}

export async function createRole(prisma: AppPrisma, body: CreateRoleInput) {
  return prisma.role.create({ data: { name: body.name, description: body.description, isActive: body.isActive } });
}

export async function findRoleOrThrow(prisma: AppPrisma, id: string) {
  return prisma.role.findUniqueOrThrow({ where: { id }, include: roleInclude });
}

export async function updateRole(prisma: AppPrisma, id: string, body: UpdateRoleInput) {
  return prisma.role.update({ where: { id }, data: { name: body.name, description: body.description, isActive: body.isActive } });
}

export async function deleteRole(prisma: AppPrisma, id: string) { return prisma.role.delete({ where: { id } }); }

export async function findUsers(prisma: AppPrisma, query: UsersQuery) {
  return prisma.user.findMany({
    where: query.q ? { OR: [{ email: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: userInclude
  });
}

export async function findUserOrThrow(prisma: AppPrisma, id: string) { return prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude }); }
export async function findUserIdentityOrThrow(prisma: AppPrisma, id: string) { return prisma.user.findUniqueOrThrow({ where: { id }, select: { keycloakId: true, name: true } }); }
export async function updateUserIdentity(prisma: AppPrisma, id: string, data: { email?: string; name?: string }) { return prisma.user.update({ where: { id }, data }); }
export async function upsertUserProfile(prisma: AppPrisma, userId: string, data: { weight?: number | null; height?: number | null }) { return prisma.profile.upsert({ where: { userId }, update: data, create: { userId, weight: data.weight, height: data.height } }); }
export async function countRolesByIds(prisma: AppPrisma, roleIds: string[]) { return prisma.role.count({ where: { id: { in: roleIds } } }); }
export async function findAdminRoleId(prisma: AppPrisma, adminRoleName: string) { return prisma.role.findUnique({ where: { name: adminRoleName }, select: { id: true } }); }
export async function findUserRoleAssignment(prisma: AppPrisma, userId: string, roleId: string) { return prisma.userRole.findUnique({ where: { userId_roleId: { userId, roleId } }, select: { userId: true } }); }
export async function countUserRoleAssignments(prisma: AppPrisma, roleId: string) { return prisma.userRole.count({ where: { roleId } }); }

export async function replaceUserRoles(prisma: AppPrisma, userId: string, roleIds: string[]) {
  await prisma.userRole.deleteMany({ where: { userId } });
  if (roleIds.length > 0) {
    await prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })), skipDuplicates: true });
  }
}
