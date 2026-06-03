import type { AppPrisma } from "../../../infra/prisma.js";
import type { PermissionDefinition } from "./permissions.js";
export async function upsertPermission(prisma: AppPrisma, permission: PermissionDefinition) { return prisma.permission.upsert({ where: { code: permission.code }, update: { category: permission.category, categoryLabel: permission.categoryLabel, action: permission.action, scope: permission.scope, label: permission.label }, create: permission }); }
export async function upsertSystemRole(prisma: AppPrisma, name: string, description: string) { return prisma.role.upsert({ where: { name }, update: { isSystem: true, isActive: true }, create: { name, description, isSystem: true, isActive: true } }); }
export async function findPermissionIds(prisma: AppPrisma, permissionCodes: readonly string[]) { return prisma.permission.findMany({ where: { code: { in: [...permissionCodes] } }, select: { id: true } }); }
export async function clearRolePermissions(prisma: AppPrisma, roleId: string) { return prisma.rolePermission.deleteMany({ where: { roleId } }); }
export async function createRolePermissions(prisma: AppPrisma, roleId: string, permissionIds: string[]) { return prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })), skipDuplicates: true }); }
export async function findRoleIdByName(prisma: AppPrisma, name: string) { return prisma.role.findUnique({ where: { name }, select: { id: true } }); }
export async function upsertUserRole(prisma: AppPrisma, userId: string, roleId: string) { return prisma.userRole.upsert({ where: { userId_roleId: { userId, roleId } }, update: {}, create: { userId, roleId } }); }
