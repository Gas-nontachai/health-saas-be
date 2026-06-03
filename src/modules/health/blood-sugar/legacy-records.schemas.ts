import { z } from "zod";
import { bloodSugarSchema, idParamsSchema, isoDatetimeSchema } from "../../../common/validation.js";

export const createRecordSchema = z.object({
  datetime: isoDatetimeSchema,
  bloodSugar: bloodSugarSchema,
  medMorning: z.number().int().nonnegative().optional().nullable(),
  medEvening: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(1000).optional().nullable()
});

export const updateRecordSchema = createRecordSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
export const paginationSchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export { idParamsSchema };
export type CreateRecordInput = z.infer<typeof createRecordSchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;
export type PaginationQuery = z.infer<typeof paginationSchema>;
