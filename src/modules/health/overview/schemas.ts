import { z } from "zod";
import { BLOOD_SUGAR_HEALTH_WIDGET_KEYS, WEIGHT_WIDGET_KEYS } from "../dashboard/constants.js";
import { buildHealthDashboardWidgetSelection } from "../dashboard/preferences.js";
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

export const healthDashboardQuerySchema = z
  .object({
    range: healthRangeSchema,
    dataTypes: healthDataTypesQuerySchema(),
    widgets: dashboardWidgetsQuerySchema()
  })
  .superRefine((value, ctx) => {
    try {
      buildHealthDashboardWidgetSelection(value.dataTypes, value.widgets);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["widgets"],
        message: error instanceof Error ? error.message : "Invalid dashboard widgets"
      });
    }
  });

export const healthDashboardPreferenceBodySchema = z.object({
  widgets: z
    .object({
      bloodSugar: z.array(z.enum(BLOOD_SUGAR_HEALTH_WIDGET_KEYS)).optional(),
      weight: z.array(z.enum(WEIGHT_WIDGET_KEYS)).optional()
    })
    .refine((value) => value.bloodSugar !== undefined || value.weight !== undefined, "widgets must include at least one data type")
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

function dashboardWidgetsQuerySchema() {
  return z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (!value) return;
      const widgets = value.split(",");
      if (widgets.length === 0 || widgets.some((item) => item.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "widgets must contain at least one widget key" });
      }
    })
    .transform((value) => (value ? value.split(",") : null));
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

export type HealthDashboardPreferenceBody = z.infer<typeof healthDashboardPreferenceBodySchema>;
