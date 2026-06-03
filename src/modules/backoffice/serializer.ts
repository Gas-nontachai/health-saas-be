import type { findRoleOrThrow, findUserOrThrow } from "./repository.js";

export function serializeRole(role: Awaited<ReturnType<typeof findRoleOrThrow>>) {
  const permissions = role.permissions.map((rolePermission) => rolePermission.permission).sort((a, b) => a.code.localeCompare(b.code));

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

export function serializeUser(user: Awaited<ReturnType<typeof findUserOrThrow>>) {
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
