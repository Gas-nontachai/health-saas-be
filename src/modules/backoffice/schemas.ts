import { z } from "zod";
import { idParamsSchema } from "../../common/validation.js";
import { isKnownPermissionCode } from "../identity/rbac/permissions.js";

const permissionCodesSchema = z.array(z.string().refine(isKnownPermissionCode, "Unknown permission code")).default([]);

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  permissions: permissionCodesSchema
});

export const updateRoleSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
    permissions: permissionCodesSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateUserRolesSchema = z.object({ roleIds: z.array(z.string().uuid()) });

export const updateUserProfileSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    weight: z.number().positive().optional().nullable(),
    height: z.number().positive().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const usersQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export { idParamsSchema };

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
