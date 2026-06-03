import { z } from "zod";
import { DEFAULT_WIDGETS, WIDGET_KEYS, type WidgetKey } from "./constants.js";

export const dashboardPreferenceBodySchema = z.object({
  widgets: z.array(
    z.string().refine((key): key is WidgetKey => WIDGET_KEYS.includes(key as WidgetKey), {
      message: "Unknown dashboard widget key"
    })
  )
});

export const dashboardQuerySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d"),
  widgets: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return DEFAULT_WIDGETS;
      const keys = value.split(",").filter((k): k is WidgetKey => WIDGET_KEYS.includes(k as WidgetKey));
      return keys.length > 0 ? keys : DEFAULT_WIDGETS;
    })
});
