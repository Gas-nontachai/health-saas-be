import type { AppPrisma } from "../../../infra/prisma.js";
import { PERMISSIONS, PERMISSION_CODES, USER_DEFAULT_PERMISSION_CODES } from "./permissions.js";
import { clearRolePermissions, createRolePermissions, findPermissionIds, findRoleIdByName, upsertPermission, upsertSystemRole, upsertUserRole } from "./repository.js";
const ADMIN_ROLE_NAME = "Admin";
const USER_ROLE_NAME = "User";
export type SyncPermissionsResult = { permissions: number; adminRoleId: string; userRoleId: string };
export async function syncPermissions(prisma: AppPrisma): Promise<SyncPermissionsResult> {
  for (const permission of PERMISSIONS) await upsertPermission(prisma, permission);
  const adminRole = await upsertSystemRole(prisma, ADMIN_ROLE_NAME, "System administrator");
  const userRole = await upsertSystemRole(prisma, USER_ROLE_NAME, "Default self-service user");
  await grantPermissionsToRole(prisma, adminRole.id, PERMISSION_CODES);
  await grantPermissionsToRole(prisma, userRole.id, USER_DEFAULT_PERMISSION_CODES);
  return { permissions: PERMISSIONS.length, adminRoleId: adminRole.id, userRoleId: userRole.id };
}
export async function grantPermissionsToRole(prisma: AppPrisma, roleId: string, permissionCodes: readonly string[]): Promise<void> {
  const permissions = await findPermissionIds(prisma, permissionCodes);
  await clearRolePermissions(prisma, roleId);
  if (permissions.length === 0) return;
  await createRolePermissions(prisma, roleId, permissions.map((permission) => permission.id));
}
export async function assignDefaultUserRole(prisma: AppPrisma, userId: string): Promise<void> { const role = await findRoleIdByName(prisma, USER_ROLE_NAME); if (!role) return; await upsertUserRole(prisma, userId, role.id); }
export async function bootstrapInitialAdmin(prisma: AppPrisma, userId: string, userEmail: string, initialAdminEmail?: string): Promise<void> { if (!initialAdminEmail || userEmail.toLowerCase() !== initialAdminEmail.toLowerCase()) return; const role = await findRoleIdByName(prisma, ADMIN_ROLE_NAME); if (!role) return; await upsertUserRole(prisma, userId, role.id); }
export { ADMIN_ROLE_NAME, USER_ROLE_NAME };
