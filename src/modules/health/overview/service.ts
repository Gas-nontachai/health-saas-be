import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import { buildExcel, buildPdf, buildUnifiedHealthExcel, buildUnifiedHealthPdf, buildWeightProgressExcel, buildWeightProgressPdf, type ExportContext, type WeightProgressContext } from "../export/builders.js";
import { buildBloodSugarAlerts, buildBloodSugarSeries, buildBloodSugarSummary, findBloodSugarRecords, getBloodSugarExportData } from "../blood-sugar/service.js";
import { buildWeightForecastResponse, findAllWeightEntriesForExport, findWeightEntries, findWeightGoal } from "../weight/service.js";
import { includesDataType, type HealthDataType } from "./types.js";

export async function getHealthDashboard(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", dataTypes: HealthDataType[]) {
  const wantsBloodSugar = includesDataType(dataTypes, "bloodSugar");
  const wantsWeight = includesDataType(dataTypes, "weight");
  const [bloodSugarRecords, weightGoal, weightEntries] = await Promise.all([
    wantsBloodSugar ? findBloodSugarRecords(prisma, userId, range) : Promise.resolve([]),
    wantsWeight ? findWeightGoal(prisma, userId) : Promise.resolve(null),
    wantsWeight ? findWeightEntries(prisma, userId, range) : Promise.resolve([])
  ]);
  const weightForecast = wantsWeight ? buildWeightForecastResponse(range, weightGoal, weightEntries) : null;
  return {
    range,
    dataTypes,
    summary: {
      ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarSummary(bloodSugarRecords) } : {}),
      ...(wantsWeight ? { weight: weightForecast?.cards ? { status: "ok", data: weightForecast.cards } : { status: "insufficient_data", data: null } } : {})
    },
    series: { ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarSeries(bloodSugarRecords) } : {}), ...(wantsWeight ? { weight: weightForecast?.series.actual } : {}) },
    alerts: { ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarAlerts(bloodSugarRecords) } : {}) },
    forecast: { ...(wantsWeight ? { weight: weightForecast } : {}) }
  };
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
  if (wantsBloodSugar && !wantsWeight) return { buffer: query.type === "excel" ? await buildExcel(bloodData.records, bloodContext) : await buildPdf(bloodData.records, bloodContext), filename: query.type === "excel" ? "blood-sugar-records.xlsx" : "blood-sugar-records.pdf" };
  if (wantsWeight && !wantsBloodSugar) return { buffer: query.type === "excel" ? await buildWeightProgressExcel(weightEntries, weightGoal, weightContext) : await buildWeightProgressPdf(weightEntries, weightGoal, weightContext), filename: query.type === "excel" ? "weight-progress-report.xlsx" : "weight-progress-report.pdf" };
  const input = { bloodSugar: { records: bloodData.records, context: bloodContext }, weight: { entries: weightEntries, goal: weightGoal, context: weightContext }, exportedAt, patientName: user.name ?? user.email, patientEmail: user.email };
  return { buffer: query.type === "excel" ? await buildUnifiedHealthExcel(input) : await buildUnifiedHealthPdf(input), filename: query.type === "excel" ? "health-report.xlsx" : "health-report.pdf" };
}
export function exportContentType(type: "excel" | "pdf") { return type === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf"; }
