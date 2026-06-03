import type { AppPrisma } from "../../../infra/prisma.js";
import { toDateOnly, WEIGHT_METRIC_TYPE } from "./forecast.js";
import type { EntryListQuery, GoalBody } from "./schemas.js";
export async function findWeightEntriesPage(prisma: AppPrisma, userId: string, query: EntryListQuery) {
  const dateFilter = { ...(query.from ? { gte: toDateOnly(query.from) } : {}), ...(query.to ? { lte: toDateOnly(query.to) } : {}) };
  const where = { userId, metricType: WEIGHT_METRIC_TYPE, ...(query.from || query.to ? { date: dateFilter } : {}) };
  const [entries, totalCount] = await Promise.all([prisma.healthMetricEntry.findMany({ where, orderBy: { date: "desc" }, take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) }), prisma.healthMetricEntry.count({ where })]);
  return { entries, totalCount };
}
export async function deleteWeightEntryByDate(prisma: AppPrisma, userId: string, date: Date) { return prisma.healthMetricEntry.deleteMany({ where: { userId, metricType: WEIGHT_METRIC_TYPE, date } }); }
export async function upsertWeightGoal(prisma: AppPrisma, userId: string, body: GoalBody) { return prisma.healthGoal.upsert({ where: { userId_metricType: { userId, metricType: WEIGHT_METRIC_TYPE } }, update: { startDate: toDateOnly(body.startDate), targetDate: toDateOnly(body.targetDate), startValue: body.startValue, targetValue: body.targetValue }, create: { userId, metricType: WEIGHT_METRIC_TYPE, startDate: toDateOnly(body.startDate), targetDate: toDateOnly(body.targetDate), startValue: body.startValue, targetValue: body.targetValue } }); }
