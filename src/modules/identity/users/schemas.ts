import { z } from "zod";
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  weight: z.number().positive().optional().nullable(),
  height: z.number().positive().optional().nullable()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
