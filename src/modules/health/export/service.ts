import type { AppPrisma } from "../../../infra/prisma.js";
import { buildExcel, buildPdf, type ExportContext } from "./builders.js";
import { getBloodSugarExportData } from "../blood-sugar/service.js";

export async function buildLegacyBloodSugarExport(prisma: AppPrisma, user: { id: string; name?: string | null; email: string }, type: "excel" | "pdf") {
  const { records, profile } = await getBloodSugarExportData(prisma, user.id);
  const ctx: ExportContext = { patientName: user.name ?? user.email, patientEmail: user.email, weight: profile?.weight ?? null, height: profile?.height ?? null, exportedAt: new Date() };
  return type === "excel" ? buildExcel(records, ctx) : buildPdf(records, ctx);
}
export function legacyBloodSugarExportHeaders(type: "excel" | "pdf") {
  return type === "excel"
    ? { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"blood-sugar-records.xlsx\"" }
    : { contentType: "application/pdf", disposition: "attachment; filename=\"blood-sugar-records.pdf\"" };
}
