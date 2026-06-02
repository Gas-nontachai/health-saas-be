import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildWeightProgressExcel, buildWeightProgressPdf, type WeightProgressContext } from "../../export/builders.js";
import type { AppPrisma } from "../../prisma.js";
import { composePreHandlers, requirePermission } from "../../rbac/authorize.js";
import { HttpError } from "../../shared/errors.js";
import { dateOnlyParamSchema, exportTypeSchema, healthRangeSchema, paginationSchema } from "../schemas.js";
import {
  findAllWeightEntriesForExport,
  findWeightEntries,
  findWeightGoal,
  buildWeightForecastResponse,
  serializeWeightEntries,
  upsertWeightEntryAndSyncProfile
} from "./service.js";
import { serializeGoal, serializeMetricEntry, toDateOnly, WEIGHT_METRIC_TYPE } from "./forecast.js";

const metricValueSchema = z.object({ value: z.number().positive().max(1000) });
const goalBodySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startValue: z.number().positive().max(1000),
    targetValue: z.number().positive().max(1000)
  })
  .refine((value) => toDateOnly(value.targetDate) > toDateOnly(value.startDate), "targetDate must be after startDate")
  .refine((value) => value.targetValue !== value.startValue, "targetValue must be different from startValue");

const entryListQuerySchema = paginationSchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
const forecastQuerySchema = z.object({ range: healthRangeSchema });
const exportQuerySchema = z.object({ type: exportTypeSchema });

export async function registerHealthWeightRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health/weight/entries", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const query = entryListQuerySchema.parse(request.query);
    const dateFilter = {
      ...(query.from ? { gte: toDateOnly(query.from) } : {}),
      ...(query.to ? { lte: toDateOnly(query.to) } : {})
    };
    const where = {
      userId: request.user.id,
      metricType: WEIGHT_METRIC_TYPE,
      ...(query.from || query.to ? { date: dateFilter } : {})
    };
    const [entries, totalCount] = await Promise.all([
      prisma.healthMetricEntry.findMany({
        where,
        orderBy: { date: "desc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
      }),
      prisma.healthMetricEntry.count({ where })
    ]);
    const hasMore = entries.length > query.limit;
    if (hasMore) entries.pop();
    return { data: serializeWeightEntries(entries), nextCursor: hasMore ? entries[entries.length - 1].id : null, totalCount };
  });

  app.put("/health/weight/entries/:date", { preHandler: [app.authenticate, requirePermission("weights.update.self")] }, async (request) => {
    const params = dateOnlyParamSchema.parse(request.params);
    const body = metricValueSchema.parse(request.body);
    const entry = await upsertWeightEntryAndSyncProfile(prisma, request.user.id, toDateOnly(params.date), body.value);
    return serializeMetricEntry(entry);
  });

  app.delete("/health/weight/entries/:date", { preHandler: [app.authenticate, requirePermission("weights.delete.self")] }, async (request, reply) => {
    const params = dateOnlyParamSchema.parse(request.params);
    const result = await prisma.healthMetricEntry.deleteMany({
      where: { userId: request.user.id, metricType: WEIGHT_METRIC_TYPE, date: toDateOnly(params.date) }
    });
    if (result.count === 0) throw new HttpError(404, "Weight metric entry not found");
    reply.status(204).send();
  });

  app.get("/health/weight/goal", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const goal = await findWeightGoal(prisma, request.user.id);
    return goal ? serializeGoal(goal) : null;
  });

  app.put("/health/weight/goal", { preHandler: [app.authenticate, requirePermission("weights.update.self")] }, async (request) => {
    const body = goalBodySchema.parse(request.body);
    const goal = await prisma.healthGoal.upsert({
      where: { userId_metricType: { userId: request.user.id, metricType: WEIGHT_METRIC_TYPE } },
      update: { startDate: toDateOnly(body.startDate), targetDate: toDateOnly(body.targetDate), startValue: body.startValue, targetValue: body.targetValue },
      create: { userId: request.user.id, metricType: WEIGHT_METRIC_TYPE, startDate: toDateOnly(body.startDate), targetDate: toDateOnly(body.targetDate), startValue: body.startValue, targetValue: body.targetValue }
    });
    return serializeGoal(goal);
  });

  app.get("/health/weight/forecast", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const { range } = forecastQuerySchema.parse(request.query);
    const [goal, entries] = await Promise.all([findWeightGoal(prisma, request.user.id), findWeightEntries(prisma, request.user.id, range)]);
    return buildWeightForecastResponse(range, goal, entries);
  });

  app.get("/health/weight/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => {
    const { range } = forecastQuerySchema.parse(request.query);
    const [goal, entries] = await Promise.all([findWeightGoal(prisma, request.user.id), findWeightEntries(prisma, request.user.id, range)]);
    return {
      range,
      dataType: "weight",
      forecast: buildWeightForecastResponse(range, goal, entries)
    };
  });

  app.get(
    "/health/weight/export",
    { preHandler: composePreHandlers(app.authenticate, requirePermission("export.read.self"), requirePermission("weights.read.self")) },
    async (request, reply) => {
      const { type } = exportQuerySchema.parse(request.query);
      const [goal, entries] = await Promise.all([findWeightGoal(prisma, request.user.id), findAllWeightEntriesForExport(prisma, request.user.id)]);
      const ctx: WeightProgressContext = { patientName: request.user.name ?? request.user.email, patientEmail: request.user.email, exportedAt: new Date() };
      if (type === "excel") {
        const buffer = await buildWeightProgressExcel(entries, goal, ctx);
        reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", "attachment; filename=\"weight-progress-report.xlsx\"");
        return buffer;
      }
      const buffer = await buildWeightProgressPdf(entries, goal, ctx);
      reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"weight-progress-report.pdf\"");
      return buffer;
    }
  );
}
