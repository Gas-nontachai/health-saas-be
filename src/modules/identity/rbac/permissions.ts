export type PermissionDefinition = {
  code: string;
  category: string;
  categoryLabel: string;
  action: "read" | "create" | "update" | "delete" | "revoke" | "assignRoles" | "reset";
  scope: "self" | "any" | "system";
  label: string;
};

function permission(
  category: string,
  categoryLabel: string,
  action: PermissionDefinition["action"],
  scope: PermissionDefinition["scope"],
  label: string
): PermissionDefinition {
  return {
    code: `${category}.${action}.${scope}`,
    category,
    categoryLabel,
    action,
    scope,
    label
  };
}

export const PERMISSIONS = [
  permission("auth", "Authentication", "read", "self", "View current session"),
  permission("auth", "Authentication", "reset", "self", "Reset own password"),

  permission("profile", "Profile", "read", "self", "View own profile"),
  permission("profile", "Profile", "update", "self", "Update own profile"),
  permission("profile", "Profile", "read", "any", "View any user profile"),
  permission("profile", "Profile", "update", "any", "Update any user profile"),

  permission("records", "Records", "read", "self", "View own records"),
  permission("records", "Records", "create", "self", "Create own records"),
  permission("records", "Records", "update", "self", "Update own records"),
  permission("records", "Records", "delete", "self", "Delete own records"),
  permission("records", "Records", "read", "any", "View any user records"),
  permission("records", "Records", "create", "any", "Create records for any user"),
  permission("records", "Records", "update", "any", "Update any user records"),
  permission("records", "Records", "delete", "any", "Delete any user records"),

  permission("dashboard", "Dashboard", "read", "self", "View own dashboard"),
  permission("dashboard", "Dashboard", "update", "self", "Update own dashboard preferences"),
  permission("dashboard", "Dashboard", "read", "any", "View any user dashboard"),

  permission("export", "Export", "read", "self", "Export own records"),
  permission("export", "Export", "read", "any", "Export any user records"),

  permission("sharedLinks", "Shared Links", "read", "self", "View own shared links"),
  permission("sharedLinks", "Shared Links", "create", "self", "Create own shared links"),
  permission("sharedLinks", "Shared Links", "revoke", "self", "Revoke own shared links"),

  permission("roles", "Roles", "read", "system", "View roles"),
  permission("roles", "Roles", "create", "system", "Create roles"),
  permission("roles", "Roles", "update", "system", "Update roles"),
  permission("roles", "Roles", "delete", "system", "Delete roles"),

  permission("users", "Users", "read", "system", "View users"),
  permission("users", "Users", "update", "system", "Update users"),
  permission("users", "Users", "assignRoles", "system", "Assign user roles"),

  permission("weights", "Weight Tracking", "read", "self", "View own weight entries"),
  permission("weights", "Weight Tracking", "create", "self", "Create own weight entries"),
  permission("weights", "Weight Tracking", "update", "self", "Update own weight entries"),
  permission("weights", "Weight Tracking", "delete", "self", "Delete own weight entries"),
  permission("weights", "Weight Tracking", "read", "any", "View any user weight entries"),
  permission("weights", "Weight Tracking", "create", "any", "Create weight entries for any user"),
  permission("weights", "Weight Tracking", "update", "any", "Update any user weight entries"),
  permission("weights", "Weight Tracking", "delete", "any", "Delete any user weight entries")
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES = PERMISSIONS.map((permission) => permission.code);

export const USER_DEFAULT_PERMISSION_CODES = PERMISSIONS.filter((permission) => permission.scope === "self").map((permission) => permission.code);

export function isKnownPermissionCode(code: string): code is PermissionCode {
  return PERMISSION_CODES.includes(code as PermissionCode);
}
