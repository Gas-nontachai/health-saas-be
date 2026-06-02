import type { AppPrisma } from "../prisma.js";
import { PERMISSIONS, PERMISSION_CODES, USER_DEFAULT_PERMISSION_CODES } from "./permissions.js";

const ADMIN_ROLE_NAME = "Admin";
const USER_ROLE_NAME = "User";

export type SyncPermissionsResult = {
  permissions: number;
  adminRoleId: string;
  userRoleId: string;
};

export async function syncPermissions(prisma: AppPrisma): Promise<SyncPermissionsResult> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        category: permission.category,
        categoryLabel: permission.categoryLabel,
        action: permission.action,
        scope: permission.scope,
        label: permission.label
      },
      create: permission
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { name: ADMIN_ROLE_NAME },
    update: { isSystem: true, isActive: true },
    create: {
      name: ADMIN_ROLE_NAME,
      description: "System administrator",
      isSystem: true,
      isActive: true
    }
  });

  const userRole = await prisma.role.upsert({
    where: { name: USER_ROLE_NAME },
    update: { isSystem: true, isActive: true },
    create: {
      name: USER_ROLE_NAME,
      description: "Default self-service user",
      isSystem: true,
      isActive: true
    }
  });

  await grantPermissionsToRole(prisma, adminRole.id, PERMISSION_CODES);
  await grantPermissionsToRole(prisma, userRole.id, USER_DEFAULT_PERMISSION_CODES);

  return {
    permissions: PERMISSIONS.length,
    adminRoleId: adminRole.id,
    userRoleId: userRole.id
  };
}

export async function grantPermissionsToRole(prisma: AppPrisma, roleId: string, permissionCodes: readonly string[]): Promise<void> {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...permissionCodes] } },
    select: { id: true }
  });

  await prisma.rolePermission.deleteMany({
    where: { roleId }
  });

  if (permissions.length === 0) return;

  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId,
      permissionId: permission.id
    })),
    skipDuplicates: true
  });
}

export async function assignDefaultUserRole(prisma: AppPrisma, userId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { name: USER_ROLE_NAME },
    select: { id: true }
  });

  if (!role) return;

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id }
  });
}

export async function bootstrapInitialAdmin(prisma: AppPrisma, userId: string, userEmail: string, initialAdminEmail?: string): Promise<void> {
  if (!initialAdminEmail || userEmail.toLowerCase() !== initialAdminEmail.toLowerCase()) return;

  const role = await prisma.role.findUnique({
    where: { name: ADMIN_ROLE_NAME },
    select: { id: true }
  });

  if (!role) return;

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id }
  });
}

export { ADMIN_ROLE_NAME, USER_ROLE_NAME };
