import type { AppPrisma } from "../../../infra/prisma.js";
import { buildHealthReportFilename, buildUnifiedHealthExcel, buildUnifiedHealthPdf, type ExportContext } from "./builders.js";
import { getBloodSugarExportData } from "../blood-sugar/service.js";

export async function buildLegacyBloodSugarExport(prisma: AppPrisma, user: { id: string; name?: string | null; email: string }, type: "excel" | "pdf") {
  const { records, profile } = await getBloodSugarExportData(prisma, user.id);
  const exportedAt = new Date();
  const ctx: ExportContext = { patientName: user.name ?? user.email, patientEmail: user.email, weight: profile?.weight ?? null, height: profile?.height ?? null, exportedAt };
  const input = { dataTypes: ["bloodSugar" as const], bloodSugar: { records, context: ctx }, exportedAt, patientName: user.name ?? user.email, patientEmail: user.email };
  return {
    buffer: type === "excel" ? await buildUnifiedHealthExcel(input) : await buildUnifiedHealthPdf(input),
    filename: buildHealthReportFilename(["bloodSugar"], type, exportedAt)
  };
}
export function legacyBloodSugarExportHeaders(type: "excel" | "pdf", filename: string) {
  return type === "excel"
    ? { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: `attachment; filename="${filename}"` }
    : { contentType: "application/pdf", disposition: `attachment; filename="${filename}"` };
}
