import { z } from "zod";
import { HEALTH_DATA_TYPES, type HealthDataType } from "./types.js";

export const healthRangeSchema = z.enum(["7d", "30d", "all"]).default("30d");

export const exportTypeSchema = z.enum(["excel", "pdf"]);

export const dateOnlyParamSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format")
    .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), "Invalid date")
});

export const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const exportQuerySchema = z.object({
  type: exportTypeSchema,
  dataTypes: healthDataTypesQuerySchema()
});

export const healthDashboardQuerySchema = z.object({
  range: healthRangeSchema,
  dataTypes: healthDataTypesQuerySchema()
});

export const sharedLinkDataTypesSchema = z
  .array(z.enum(HEALTH_DATA_TYPES))
  .min(1, "dataTypes must contain at least one data type")
  .transform((value) => normalizeHealthDataTypes(value));

export function parseHealthDataTypes(value: string | undefined): HealthDataType[] {
  if (!value) return ["bloodSugar"];
  return normalizeHealthDataTypes(value.split(","));
}

function healthDataTypesQuerySchema() {
  return z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const values = value ? value.split(",") : ["bloodSugar"];
      if (values.length === 0 || values.some((item) => item.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dataTypes must contain at least one data type" });
      }
      for (const item of values) {
        if (!HEALTH_DATA_TYPES.includes(item as HealthDataType)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown health data type: ${item}` });
        }
      }
    })
    .transform((value) => parseHealthDataTypes(value));
}

export function normalizeHealthDataTypes(values: readonly string[]): HealthDataType[] {
  const normalized: HealthDataType[] = [];
  for (const value of values) {
    if (!HEALTH_DATA_TYPES.includes(value as HealthDataType)) {
      throw new Error(`Unknown health data type: ${value}`);
    }
    if (!normalized.includes(value as HealthDataType)) normalized.push(value as HealthDataType);
  }
  if (normalized.length === 0) {
    throw new Error("dataTypes must contain at least one data type");
  }
  return normalized;
}
