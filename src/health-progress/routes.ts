import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildWeightProgressExcel, buildWeightProgressPdf, type WeightProgressContext } from "../export/builders.js";
import type { AppPrisma } from "../prisma.js";
import { composePreHandlers, requirePermission } from "../rbac/authorize.js";
import { HttpError } from "../shared/errors.js";
import {
  buildForecastSeries,
  buildRollingAverageSeries,
  calculateEta,
  calculateProgressPercent,
  calculateTrend,
  compareWithForecast,
  formatDate,
  getRangeStart,
  getVisibleForecastStart,
  interpolateForecast,
  round1,
  serializeGoal,
  serializeMetricEntry,
  toDateOnly,
  todayUtc,
  WEIGHT_METRIC_TYPE,
  type GoalRow,
  type MetricEntryRow
} from "./forecast.js";

const dateParamSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format")
    .refine((value) => toDateOnly(value).toISOString().startsWith(value), "Invalid date")
});

const metricValueSchema = z.object({
  value: z.number().positive().max(1000)
});

const goalBodySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must use YYYY-MM-DD format")
      .refine((value) => toDateOnly(value).toISOString().startsWith(value), "Invalid startDate"),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must use YYYY-MM-DD format")
      .refine((value) => toDateOnly(value).toISOString().startsWith(value), "Invalid targetDate"),
    startValue: z.number().positive().max(1000),
    targetValue: z.number().positive().max(1000)
  })
  .refine((value) => toDateOnly(value.targetDate) > toDateOnly(value.startDate), {
    message: "targetDate must be after startDate"
  })
  .refine((value) => value.targetValue !== value.startValue, {
    message: "targetValue must be different from startValue"
  });

const metricListQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "from must use YYYY-MM-DD format")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "to must use YYYY-MM-DD format")
      .optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
  .refine((value) => !value.from || toDateOnly(value.from).toISOString().startsWith(value.from), "Invalid from")
  .refine((value) => !value.to || toDateOnly(value.to).toISOString().startsWith(value.to), "Invalid to")
  .refine((value) => !value.from || !value.to || toDateOnly(value.to) >= toDateOnly(value.from), {
    message: "to must be on or after from"
  });

const forecastQuerySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d")
});

const exportQuerySchema = z.object({
  type: z.enum(["excel", "pdf"])
});

export async function registerHealthProgressRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health-progress/metrics/weight", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const query = metricListQuerySchema.parse(request.query);
    const dateFilter = buildDateFilter(query.from, query.to);
    const where = {
      userId: request.user.id,
      metricType: WEIGHT_METRIC_TYPE,
      ...(dateFilter ? { date: dateFilter } : {})
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

    return {
      data: entries.map(serializeMetricEntry),
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
      totalCount
    };
  });

  app.put("/health-progress/metrics/weight/:date", { preHandler: [app.authenticate, requirePermission("weights.update.self")] }, async (request) => {
    const params = dateParamSchema.parse(request.params);
    const body = metricValueSchema.parse(request.body);
    const date = toDateOnly(params.date);

    const entry = await prisma.healthMetricEntry.upsert({
      where: {
        userId_metricType_date: {
          userId: request.user.id,
          metricType: WEIGHT_METRIC_TYPE,
          date
        }
      },
      update: { value: body.value },
      create: {
        userId: request.user.id,
        metricType: WEIGHT_METRIC_TYPE,
        date,
        value: body.value
      }
    });

    return serializeMetricEntry(entry);
  });

  app.delete("/health-progress/metrics/weight/:date", { preHandler: [app.authenticate, requirePermission("weights.delete.self")] }, async (request, reply) => {
    const params = dateParamSchema.parse(request.params);
    const result = await prisma.healthMetricEntry.deleteMany({
      where: {
        userId: request.user.id,
        metricType: WEIGHT_METRIC_TYPE,
        date: toDateOnly(params.date)
      }
    });

    if (result.count === 0) {
      throw new HttpError(404, "Weight metric entry not found");
    }

    reply.status(204).send();
  });

  app.get("/health-progress/goals/weight", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const goal = await prisma.healthGoal.findUnique({
      where: {
        userId_metricType: {
          userId: request.user.id,
          metricType: WEIGHT_METRIC_TYPE
        }
      }
    });

    return goal ? serializeGoal(goal) : null;
  });

  app.put("/health-progress/goals/weight", { preHandler: [app.authenticate, requirePermission("weights.update.self")] }, async (request) => {
    const body = goalBodySchema.parse(request.body);
    const goal = await prisma.healthGoal.upsert({
      where: {
        userId_metricType: {
          userId: request.user.id,
          metricType: WEIGHT_METRIC_TYPE
        }
      },
      update: {
        startDate: toDateOnly(body.startDate),
        targetDate: toDateOnly(body.targetDate),
        startValue: body.startValue,
        targetValue: body.targetValue
      },
      create: {
        userId: request.user.id,
        metricType: WEIGHT_METRIC_TYPE,
        startDate: toDateOnly(body.startDate),
        targetDate: toDateOnly(body.targetDate),
        startValue: body.startValue,
        targetValue: body.targetValue
      }
    });

    return serializeGoal(goal);
  });

  app.get("/health-progress/forecast/weight", { preHandler: [app.authenticate, requirePermission("weights.read.self")] }, async (request) => {
    const query = forecastQuerySchema.parse(request.query);
    const now = todayUtc();
    const rangeStart = getRangeStart(query.range, now);
    const dateFilter = rangeStart ? { gte: rangeStart } : undefined;

    const [goal, entries] = await Promise.all([
      prisma.healthGoal.findUnique({
        where: {
          userId_metricType: {
            userId: request.user.id,
            metricType: WEIGHT_METRIC_TYPE
          }
        }
      }),
      prisma.healthMetricEntry.findMany({
        where: {
          userId: request.user.id,
          metricType: WEIGHT_METRIC_TYPE,
          ...(dateFilter ? { date: dateFilter } : {})
        },
        orderBy: { date: "asc" }
      })
    ]);

    return buildForecastResponse(query.range, goal, entries, now);
  });

  app.get(
    "/health-progress/export/weight",
    { preHandler: composePreHandlers(app.authenticate, requirePermission("export.read.self"), requirePermission("weights.read.self")) },
    async (request, reply) => {
      const query = exportQuerySchema.parse(request.query);

      const [goal, entries] = await Promise.all([
        prisma.healthGoal.findUnique({
          where: {
            userId_metricType: {
              userId: request.user.id,
              metricType: WEIGHT_METRIC_TYPE
            }
          }
        }),
        prisma.healthMetricEntry.findMany({
          where: {
            userId: request.user.id,
            metricType: WEIGHT_METRIC_TYPE
          },
          orderBy: { date: "asc" },
          take: 1000
        })
      ]);

      const ctx: WeightProgressContext = {
        patientName: request.user.name ?? request.user.email,
        patientEmail: request.user.email,
        exportedAt: new Date()
      };

      if (query.type === "excel") {
        const buffer = await buildWeightProgressExcel(entries, goal, ctx);
        reply
          .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("content-disposition", "attachment; filename=\"weight-progress-report.xlsx\"");
        return buffer;
      }

      if (query.type === "pdf") {
        const buffer = await buildWeightProgressPdf(entries, goal, ctx);
        reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"weight-progress-report.pdf\"");
        return buffer;
      }

      throw new HttpError(400, "Unsupported export type");
    }
  );
}

function buildForecastResponse(range: "7d" | "30d" | "all", goal: GoalRow | null, entries: MetricEntryRow[], now: Date) {
  if (!goal) {
    return {
      range,
      metricType: WEIGHT_METRIC_TYPE,
      status: "insufficient_data",
      message: "Weight goal is required to calculate forecast",
      goal: null,
      cards: null,
      series: emptySeries()
    };
  }

  if (entries.length === 0) {
    return {
      range,
      metricType: WEIGHT_METRIC_TYPE,
      status: "insufficient_data",
      message: "At least one weight entry is required to compare actual progress",
      goal: serializeGoal(goal),
      cards: null,
      series: {
        ...emptySeries(),
        forecast: buildForecastSeries(goal, getVisibleForecastStart(goal, range, now), goal.targetDate)
      }
    };
  }

  const latest = entries[entries.length - 1];
  const totalChange = latest.value - entries[0].value;
  const min = Math.min(...entries.map((entry) => entry.value));
  const max = Math.max(...entries.map((entry) => entry.value));
  const rollingAverage = buildRollingAverageSeries(entries);
  const trend = calculateTrend(entries);
  const forecastValue = interpolateForecast(goal, latest.date);
  const status = compareWithForecast(goal, latest.value, forecastValue);
  const eta = calculateEta(goal, latest, trend.kgPerWeek);
  const progressPercent = calculateProgressPercent(goal, latest.value);

  return {
    range,
    metricType: WEIGHT_METRIC_TYPE,
    status,
    goal: serializeGoal(goal),
    cards: {
      currentValue: round1(latest.value),
      lowestValue: round1(min),
      highestValue: round1(max),
      totalChange: round1(totalChange),
      trendKgPerWeek: trend.status === "ok" ? round1(trend.kgPerWeek) : null,
      eta,
      targetProgress: {
        percent: progressPercent,
        remainingValue: round1(goal.targetValue - latest.value)
      },
      forecastComparison: {
        date: formatDate(latest.date),
        forecastValue: round1(forecastValue),
        delta: round1(latest.value - forecastValue)
      }
    },
    series: {
      actual: entries.map((entry) => ({ date: formatDate(entry.date), value: round1(entry.value) })),
      rollingAverage,
      forecast: buildForecastSeries(goal, getVisibleForecastStart(goal, range, now), goal.targetDate)
    }
  };
}

function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return null;

  return {
    ...(from ? { gte: toDateOnly(from) } : {}),
    ...(to ? { lte: toDateOnly(to) } : {})
  };
}

function emptySeries() {
  return {
    actual: [],
    rollingAverage: [],
    forecast: []
  };
}
