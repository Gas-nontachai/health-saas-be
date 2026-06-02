import type { FastifyInstance } from "fastify";
import {
  buildExcel,
  buildPdf,
  buildUnifiedHealthExcel,
  buildUnifiedHealthPdf,
  buildWeightProgressExcel,
  buildWeightProgressPdf,
  type ExportContext,
  type WeightProgressContext
} from "../export/builders.js";
import type { AppPrisma } from "../prisma.js";
import { composePreHandlers, requirePermission } from "../rbac/authorize.js";
import { HttpError } from "../shared/errors.js";
import { exportQuerySchema, healthDashboardQuerySchema } from "./schemas.js";
import { includesDataType } from "./types.js";
import { buildBloodSugarAlerts, buildBloodSugarSeries, buildBloodSugarSummary, findBloodSugarRecords } from "./blood-sugar/service.js";
import { buildWeightForecastResponse, findAllWeightEntriesForExport, findWeightEntries, findWeightGoal } from "./weight/service.js";

export async function registerHealthRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => {
    const query = healthDashboardQuerySchema.parse(request.query);
    const wantsBloodSugar = includesDataType(query.dataTypes, "bloodSugar");
    const wantsWeight = includesDataType(query.dataTypes, "weight");

    const [bloodSugarRecords, weightGoal, weightEntries] = await Promise.all([
      wantsBloodSugar ? findBloodSugarRecords(prisma, request.user.id, query.range) : Promise.resolve([]),
      wantsWeight ? findWeightGoal(prisma, request.user.id) : Promise.resolve(null),
      wantsWeight ? findWeightEntries(prisma, request.user.id, query.range) : Promise.resolve([])
    ]);

    return {
      range: query.range,
      dataTypes: query.dataTypes,
      summary: {
        ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarSummary(bloodSugarRecords) } : {}),
        ...(wantsWeight
          ? {
              weight: buildWeightForecastResponse(query.range, weightGoal, weightEntries).cards
                ? { status: "ok", data: buildWeightForecastResponse(query.range, weightGoal, weightEntries).cards }
                : { status: "insufficient_data", data: null }
            }
          : {})
      },
      series: {
        ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarSeries(bloodSugarRecords) } : {}),
        ...(wantsWeight ? { weight: buildWeightForecastResponse(query.range, weightGoal, weightEntries).series.actual } : {})
      },
      alerts: {
        ...(wantsBloodSugar ? { bloodSugar: buildBloodSugarAlerts(bloodSugarRecords) } : {})
      },
      forecast: {
        ...(wantsWeight ? { weight: buildWeightForecastResponse(query.range, weightGoal, weightEntries) } : {})
      }
    };
  });

  app.get(
    "/health/export",
    { preHandler: composePreHandlers(app.authenticate, requirePermission("export.read.self")) },
    async (request, reply) => {
      const query = exportQuerySchema.parse(request.query);
      const wantsBloodSugar = includesDataType(query.dataTypes, "bloodSugar");
      const wantsWeight = includesDataType(query.dataTypes, "weight");
      if (wantsWeight) {
        if (!request.user.permissions.includes("weights.read.self")) {
          throw new HttpError(403, "Permission denied: weights.read.self");
        }
      }

      const [records, profile, weightGoal, weightEntries] = await Promise.all([
        wantsBloodSugar
          ? prisma.record.findMany({
              where: { userId: request.user.id },
              orderBy: { datetime: "asc" },
              take: 1000,
              select: { datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true }
            })
          : Promise.resolve([]),
        wantsBloodSugar ? prisma.profile.findUnique({ where: { userId: request.user.id }, select: { weight: true, height: true } }) : Promise.resolve(null),
        wantsWeight ? findWeightGoal(prisma, request.user.id) : Promise.resolve(null),
        wantsWeight ? findAllWeightEntriesForExport(prisma, request.user.id) : Promise.resolve([])
      ]);

      const exportedAt = new Date();
      const bloodContext: ExportContext = {
        patientName: request.user.name ?? request.user.email,
        patientEmail: request.user.email,
        weight: profile?.weight ?? null,
        height: profile?.height ?? null,
        exportedAt
      };
      const weightContext: WeightProgressContext = {
        patientName: request.user.name ?? request.user.email,
        patientEmail: request.user.email,
        exportedAt
      };

      if (wantsBloodSugar && !wantsWeight) {
        if (query.type === "excel") {
          const buffer = await buildExcel(records, bloodContext);
          reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", "attachment; filename=\"blood-sugar-records.xlsx\"");
          return buffer;
        }
        const buffer = await buildPdf(records, bloodContext);
        reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"blood-sugar-records.pdf\"");
        return buffer;
      }

      if (wantsWeight && !wantsBloodSugar) {
        if (query.type === "excel") {
          const buffer = await buildWeightProgressExcel(weightEntries, weightGoal, weightContext);
          reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", "attachment; filename=\"weight-progress-report.xlsx\"");
          return buffer;
        }
        const buffer = await buildWeightProgressPdf(weightEntries, weightGoal, weightContext);
        reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"weight-progress-report.pdf\"");
        return buffer;
      }

      const input = {
        bloodSugar: { records, context: bloodContext },
        weight: { entries: weightEntries, goal: weightGoal, context: weightContext },
        exportedAt,
        patientName: request.user.name ?? request.user.email,
        patientEmail: request.user.email
      };
      if (query.type === "excel") {
        const buffer = await buildUnifiedHealthExcel(input);
        reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", "attachment; filename=\"health-report.xlsx\"");
        return buffer;
      }
      const buffer = await buildUnifiedHealthPdf(input);
      reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"health-report.pdf\"");
      return buffer;
    }
  );
}
