import { z } from "zod";
import { idParamsSchema, isoDatetimeSchema } from "../../../common/validation.js";
import { sharedLinkDataTypesSchema } from "../overview/schemas.js";
import { ALLOWED_EXPIRY_DAYS, MAX_SHARED_RANGE_DAYS, MS_PER_DAY } from "./constants.js";
export const createSharedLinkSchema = z.object({ startDate: isoDatetimeSchema, endDate: isoDatetimeSchema, expiresInDays: z.number().int().refine((value): value is (typeof ALLOWED_EXPIRY_DAYS)[number] => ALLOWED_EXPIRY_DAYS.includes(value as (typeof ALLOWED_EXPIRY_DAYS)[number]), "expiresInDays must be one of 1, 3, 7, or 30"), dataTypes: sharedLinkDataTypesSchema.default(["bloodSugar"]) }).transform((value) => ({ dataStartAt: new Date(value.startDate), dataEndAt: new Date(value.endDate), expiresInDays: value.expiresInDays, dataTypes: value.dataTypes })).superRefine((value, ctx) => { if (value.dataStartAt > value.dataEndAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must be after or equal to startDate" }); if (value.dataEndAt.getTime() - value.dataStartAt.getTime() > MAX_SHARED_RANGE_DAYS * MS_PER_DAY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: `Shared data range cannot exceed ${MAX_SHARED_RANGE_DAYS} days` }); });
export const publicTokenParamsSchema = z.object({ token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/) });
export { idParamsSchema };
export type CreateSharedLinkInput = z.infer<typeof createSharedLinkSchema>;
