import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import { buildHealthReportFilename, buildUnifiedHealthExcel, buildUnifiedHealthPdf, type ExportContext, type WeightProgressContext } from "../export/builders.js";
import { findBloodSugarRecords, getBloodSugarExportData } from "../blood-sugar/service.js";
import { buildWeightForecastResponse, findAllWeightEntriesForExport, findWeightEntries, findWeightGoal } from "../weight/service.js";
import { DEFAULT_HEALTH_DASHBOARD_WIDGETS, HEALTH_DASHBOARD_WIDGETS, type BloodSugarHealthWidgetKey, type WeightWidgetKey, type WidgetKey } from "../dashboard/constants.js";
import { findDashboardData, findDashboardPreference, saveDashboardPreference } from "../dashboard/repository.js";
import { buildHealthDashboardWidgetSelection, normalizeHealthDashboardWidgets, type SelectedHealthDashboardWidgets } from "../dashboard/preferences.js";
import { buildWidget, type WidgetResult } from "../dashboard/widgets.js";
import { HEALTH_DATA_TYPES, includesDataType, type HealthDataType } from "./types.js";

export async function getHealthDashboard(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", dataTypes: HealthDataType[], requestedWidgets: string[] | null) {
  const selectedWidgets = buildHealthDashboardWidgetSelection(dataTypes, requestedWidgets);
  const wantsBloodSugar = includesDataType(dataTypes, "bloodSugar");
  const wantsWeight = includesDataType(dataTypes, "weight");
  const bloodSugarWidgets = selectedWidgets.bloodSugar ?? [];
  const weightWidgets = selectedWidgets.weight ?? [];
  const now = new Date();
  const [bloodSugarData, weightGoal, weightEntries] = await Promise.all([
    wantsBloodSugar && bloodSugarWidgets.length > 0 ? findDashboardData(prisma, userId, range, bloodSugarWidgets as WidgetKey[], now) : Promise.resolve(null),
    wantsWeight && weightWidgets.length > 0 ? findWeightGoal(prisma, userId) : Promise.resolve(null),
    wantsWeight && weightWidgets.length > 0 ? findWeightEntries(prisma, userId, range) : Promise.resolve([])
  ]);
  const weightForecast = wantsWeight && weightWidgets.length > 0 ? buildWeightForecastResponse(range, weightGoal, weightEntries) : null;
  return {
    range,
    dataTypes,
    availableDataTypes: [...HEALTH_DATA_TYPES],
    availableWidgets: pickByDataTypes(HEALTH_DASHBOARD_WIDGETS, dataTypes),
    defaultWidgets: pickByDataTypes(DEFAULT_HEALTH_DASHBOARD_WIDGETS, dataTypes),
    widgets: {
      ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarHealthWidgets(bloodSugarWidgets, bloodSugarData, range, now) } : {}),
      ...(wantsWeight ? { weight: buildWeightHealthWidgets(weightWidgets, weightForecast) } : {})
    }
  };
}

export async function getHealthDashboardPreferences(prisma: AppPrisma, userId: string) {
  const preference = await findDashboardPreference(prisma, userId);
  return { widgets: normalizeHealthDashboardWidgets(preference?.dashboardWidgets) };
}

export async function updateHealthDashboardPreferences(prisma: AppPrisma, userId: string, body: { widgets: SelectedHealthDashboardWidgets }) {
  const preference = await findDashboardPreference(prisma, userId);
  const current = normalizeHealthDashboardWidgets(preference?.dashboardWidgets);
  const widgets = normalizeHealthDashboardWidgets({
    bloodSugar: body.widgets.bloodSugar ?? current.bloodSugar,
    weight: body.widgets.weight ?? current.weight
  });
  await saveDashboardPreference(prisma, userId, widgets);
  return { widgets };
}

function pickByDataTypes<T extends Record<HealthDataType, readonly string[]>>(value: T, dataTypes: readonly HealthDataType[]) {
  return Object.fromEntries(dataTypes.map((dataType) => [dataType, [...value[dataType]]]));
}

function buildBloodSugarHealthWidgets(widgets: readonly BloodSugarHealthWidgetKey[], data: Awaited<ReturnType<typeof findDashboardData>> | null, range: "7d" | "30d" | "all", now: Date) {
  if (!data) return {};
  return Object.fromEntries(
    widgets.map((key) => [
      key,
      buildWidget(key, key === "periodComparison" && range !== "all" ? data.comparisonRecords : data.currentRecords, data.profile, range, now)
    ])
  );
}

function buildWeightHealthWidgets(widgets: readonly WeightWidgetKey[], forecast: ReturnType<typeof buildWeightForecastResponse> | null) {
  if (!forecast) return {};
  return Object.fromEntries(widgets.map((key) => [key, buildWeightWidget(key, forecast)]));
}

function buildWeightWidget(key: WeightWidgetKey, forecast: ReturnType<typeof buildWeightForecastResponse>): WidgetResult {
  switch (key) {
    case "summary":
      return forecast.cards ? { status: "ok", data: forecast.cards } : { status: "insufficient_data", message: forecast.message, data: null };
    case "trend":
      return forecast.series.actual.length > 0 ? { status: "ok", data: { actual: forecast.series.actual, rollingAverage: forecast.series.rollingAverage } } : { status: "insufficient_data", message: forecast.message ?? "At least one weight entry is required to show trend", data: { actual: [], rollingAverage: [] } };
    case "forecast":
      return forecast.status === "insufficient_data" ? { status: "insufficient_data", message: forecast.message, data: forecast } : { status: "ok", data: forecast };
    case "goalProgress":
      return forecast.cards ? { status: "ok", data: { targetProgress: forecast.cards.targetProgress, eta: forecast.cards.eta, forecastComparison: forecast.cards.forecastComparison } } : { status: "insufficient_data", message: forecast.message, data: null };
  }
}

export async function buildHealthExport(prisma: AppPrisma, user: { id: string; name?: string | null; email: string; permissions: string[] }, query: { type: "excel" | "pdf"; dataTypes: HealthDataType[] }) {
  const wantsBloodSugar = includesDataType(query.dataTypes, "bloodSugar");
  const wantsWeight = includesDataType(query.dataTypes, "weight");
  if (wantsWeight && !user.permissions.includes("weights.read.self")) throw new HttpError(403, "Permission denied: weights.read.self");
  const [bloodData, weightGoal, weightEntries] = await Promise.all([
    wantsBloodSugar ? getBloodSugarExportData(prisma, user.id) : Promise.resolve({ records: [], profile: null }),
    wantsWeight ? findWeightGoal(prisma, user.id) : Promise.resolve(null),
    wantsWeight ? findAllWeightEntriesForExport(prisma, user.id) : Promise.resolve([])
  ]);
  const exportedAt = new Date();
  const bloodContext: ExportContext = { patientName: user.name ?? user.email, patientEmail: user.email, weight: bloodData.profile?.weight ?? null, height: bloodData.profile?.height ?? null, exportedAt };
  const weightContext: WeightProgressContext = { patientName: user.name ?? user.email, patientEmail: user.email, exportedAt };
  const input = {
    dataTypes: query.dataTypes,
    ...(wantsBloodSugar ? { bloodSugar: { records: bloodData.records, context: bloodContext } } : {}),
    ...(wantsWeight ? { weight: { entries: weightEntries, goal: weightGoal, context: weightContext } } : {}),
    exportedAt,
    patientName: user.name ?? user.email,
    patientEmail: user.email
  };
  return {
    buffer: query.type === "excel" ? await buildUnifiedHealthExcel(input) : await buildUnifiedHealthPdf(input),
    filename: buildHealthReportFilename(query.dataTypes, query.type, exportedAt)
  };
}
export function exportContentType(type: "excel" | "pdf") { return type === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf"; }
