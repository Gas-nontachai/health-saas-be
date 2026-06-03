import type { AppPrisma } from "../../../infra/prisma.js";
import { DEFAULT_WIDGETS, WIDGET_KEYS, type WidgetKey } from "./constants.js";
import { findDashboardData, findDashboardPreference, saveDashboardPreference } from "./repository.js";
import { normalizeLegacyDashboardWidgets, withUpdatedLegacyBloodSugarWidgets } from "./preferences.js";
import { buildWidget, normalizeDashboardWidgets, type WidgetResult } from "./widgets.js";

export async function getDashboardPreferences(prisma: AppPrisma, userId: string) {
  const preference = await findDashboardPreference(prisma, userId);
  return { widgets: normalizeLegacyDashboardWidgets(preference?.dashboardWidgets) };
}

export async function updateDashboardPreferences(prisma: AppPrisma, userId: string, requestedWidgets: WidgetKey[]) {
  const widgets = normalizeDashboardWidgets(requestedWidgets);
  const preference = await findDashboardPreference(prisma, userId);
  await saveDashboardPreference(prisma, userId, withUpdatedLegacyBloodSugarWidgets(preference?.dashboardWidgets, widgets));
  return { widgets };
}

export async function getDashboard(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", requestedWidgets: WidgetKey[], now = new Date()) {
  const { currentRecords, comparisonRecords, profile } = await findDashboardData(prisma, userId, range, requestedWidgets, now);
  const widgets: Record<string, WidgetResult> = {};

  for (const key of requestedWidgets) {
    widgets[key] = buildWidget(key, key === "periodComparison" && range !== "all" ? comparisonRecords : currentRecords, profile, range, now);
  }

  return {
    range,
    availableWidgets: [...WIDGET_KEYS],
    defaultWidgets: [...DEFAULT_WIDGETS],
    widgets
  };
}
