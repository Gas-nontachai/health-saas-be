import type { AppPrisma } from "../../infra/prisma.js";
import { HttpError } from "../../common/errors.js";
import type { KeycloakAuthService } from "../identity/auth/keycloak.js";
import { ADMIN_ROLE_NAME, grantPermissionsToRole } from "../identity/rbac/sync.js";
import {
  countRolesByIds,
  countUserRoleAssignments,
  createRole,
  deleteRole,
  findAdminRoleId,
  findRoleOrThrow,
  findRoles,
  findUserIdentityOrThrow,
  findUserOrThrow,
  findUserRoleAssignment,
  findUsers,
  replaceUserRoles,
  updateRole,
  updateUserIdentity,
  upsertUserProfile
} from "./repository.js";
import { serializeRole, serializeUser } from "./serializer.js";
import type { CreateRoleInput, UpdateRoleInput, UpdateUserProfileInput, UsersQuery } from "./schemas.js";

export async function listRoles(prisma: AppPrisma) {
  return { data: (await findRoles(prisma)).map(serializeRole) };
}

export async function createBackofficeRole(prisma: AppPrisma, body: CreateRoleInput) {
  const role = await createRole(prisma, body);
  await grantPermissionsToRole(prisma, role.id, body.permissions);
  return serializeRole(await findRoleOrThrow(prisma, role.id));
}

export async function getBackofficeRole(prisma: AppPrisma, id: string) {
  return serializeRole(await findRoleOrThrow(prisma, id));
}

export async function updateBackofficeRole(prisma: AppPrisma, id: string, body: UpdateRoleInput) {
  const role = await findRoleOrThrow(prisma, id);

  if (role.isSystem && body.name && body.name !== role.name) {
    throw new HttpError(400, "System role name cannot be changed");
  }

  if (role.name === ADMIN_ROLE_NAME) {
    if (body.isActive === false) throw new HttpError(400, "Admin role cannot be deactivated");
    if (body.permissions && (!body.permissions.includes("roles.update.system") || !body.permissions.includes("users.assignRoles.system"))) {
      throw new HttpError(400, "Admin role must keep role management permissions");
    }
  }

  await updateRole(prisma, id, body);
  if (body.permissions) await grantPermissionsToRole(prisma, id, body.permissions);
  return serializeRole(await findRoleOrThrow(prisma, id));
}

export async function deleteBackofficeRole(prisma: AppPrisma, id: string) {
  const role = await findRoleOrThrow(prisma, id);
  if (role.isSystem) throw new HttpError(400, "System roles cannot be deleted");
  await deleteRole(prisma, id);
}

export async function listUsers(prisma: AppPrisma, query: UsersQuery) {
  return { data: (await findUsers(prisma, query)).map(serializeUser) };
}

export async function getBackofficeUser(prisma: AppPrisma, id: string) {
  return serializeUser(await findUserOrThrow(prisma, id));
}

export async function updateBackofficeUserProfile(prisma: AppPrisma, keycloakAuth: KeycloakAuthService, id: string, body: UpdateUserProfileInput) {
  const user = await findUserIdentityOrThrow(prisma, id);
  const { firstName, lastName, email, ...profileData } = body;

  if (firstName !== undefined || lastName !== undefined || email !== undefined) {
    await keycloakAuth.updateUser({ keycloakId: user.keycloakId, firstName, lastName, email });

    const updateData: { email?: string; name?: string } = {};
    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined || lastName !== undefined) {
      const [currentFirst, ...rest] = (user.name ?? "").split(" ");
      updateData.name = `${firstName ?? currentFirst} ${lastName ?? rest.join(" ")}`.trim();
    }
    if (Object.keys(updateData).length > 0) await updateUserIdentity(prisma, id, updateData);
  }

  await upsertUserProfile(prisma, id, profileData);
  return serializeUser(await findUserOrThrow(prisma, id));
}

export async function updateBackofficeUserRoles(prisma: AppPrisma, id: string, roleIds: string[]) {
  await assertRolesExist(prisma, roleIds);
  await assertNotRemovingLastAdmin(prisma, id, roleIds);
  await replaceUserRoles(prisma, id, roleIds);
  return serializeUser(await findUserOrThrow(prisma, id));
}

async function assertRolesExist(prisma: AppPrisma, roleIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(roleIds)];
  const count = await countRolesByIds(prisma, uniqueIds);
  if (count !== uniqueIds.length) throw new HttpError(400, "One or more roles do not exist");
}

async function assertNotRemovingLastAdmin(prisma: AppPrisma, userId: string, nextRoleIds: string[]): Promise<void> {
  const adminRole = await findAdminRoleId(prisma, ADMIN_ROLE_NAME);
  if (!adminRole || nextRoleIds.includes(adminRole.id)) return;

  const currentAdminAssignment = await findUserRoleAssignment(prisma, userId, adminRole.id);
  if (!currentAdminAssignment) return;

  const adminCount = await countUserRoleAssignments(prisma, adminRole.id);
  if (adminCount <= 1) throw new HttpError(400, "Cannot remove the last admin user");
}
