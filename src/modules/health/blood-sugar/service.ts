import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import { createBloodSugarRecord, deleteBloodSugarRecord, findBloodSugarEntriesPage, findBloodSugarExportData, findOwnedRecordId, updateBloodSugarRecord } from "./repository.js";
import type { CreateBloodSugarRecordInput, PaginationQuery, UpdateBloodSugarRecordInput } from "./schemas.js";

export async function listBloodSugarEntries(prisma: AppPrisma, userId: string, query: PaginationQuery) {
  const { records, totalCount } = await findBloodSugarEntriesPage(prisma, userId, query);
  const hasMore = records.length > query.limit;
  if (hasMore) records.pop();
  return { data: records, nextCursor: hasMore ? records[records.length - 1].id : null, totalCount };
}
export async function createUserBloodSugarRecord(prisma: AppPrisma, userId: string, body: CreateBloodSugarRecordInput) { return createBloodSugarRecord(prisma, userId, body); }
export async function updateUserBloodSugarRecord(prisma: AppPrisma, userId: string, id: string, body: UpdateBloodSugarRecordInput) { await assertRecordOwnership(prisma, id, userId); return updateBloodSugarRecord(prisma, id, body); }
export async function deleteUserBloodSugarRecord(prisma: AppPrisma, userId: string, id: string) { await assertRecordOwnership(prisma, id, userId); await deleteBloodSugarRecord(prisma, id); }
export async function getBloodSugarExportData(prisma: AppPrisma, userId: string) { const [records, profile] = await findBloodSugarExportData(prisma, userId); return { records, profile }; }
async function assertRecordOwnership(prisma: AppPrisma, id: string, userId: string): Promise<void> { if (!(await findOwnedRecordId(prisma, id, userId))) throw new HttpError(404, "Record not found"); }

export const BLOOD_SUGAR_LOW = 70;
export const BLOOD_SUGAR_HIGH = 180;

export type BloodSugarRecordRow = {
  datetime: Date;
  bloodSugar: number;
  medMorning: number | null;
  medEvening: number | null;
  note: string | null;
};

export function getDatetimeFilter(range: "7d" | "30d" | "all", multiplier = 1, now = new Date()) {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days * multiplier + 1);
  start.setHours(0, 0, 0, 0);
  const previousEnd = new Date(end);
  previousEnd.setDate(previousEnd.getDate() - days * (multiplier - 1));
  previousEnd.setHours(23, 59, 59, 999);
  return multiplier === 1 ? { gte: start, lte: end } : { gte: start, lte: previousEnd };
}

export async function findBloodSugarRecords(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", now = new Date()) {
  const datetimeFilter = getDatetimeFilter(range, 1, now);
  return prisma.record.findMany({
    where: {
      userId,
      ...(datetimeFilter ? { datetime: datetimeFilter } : {})
    },
    orderBy: { datetime: "asc" },
    select: {
      datetime: true,
      bloodSugar: true,
      medMorning: true,
      medEvening: true,
      note: true
    }
  });
}

export function buildBloodSugarSummary(records: BloodSugarRecordRow[]) {
  const measured = records.filter((record) => record.bloodSugar > 0);
  if (measured.length === 0) {
    return { status: "insufficient_data" as const, message: "No measured blood sugar records in selected range", data: null };
  }

  const values = measured.map((record) => record.bloodSugar);
  const low = measured.filter((record) => record.bloodSugar < BLOOD_SUGAR_LOW).length;
  const high = measured.filter((record) => record.bloodSugar > BLOOD_SUGAR_HIGH).length;
  const normal = measured.length - low - high;

  return {
    status: "ok" as const,
    data: {
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      min: Math.min(...values),
      max: Math.max(...values),
      count: measured.length,
      low,
      normal,
      high
    }
  };
}

export function buildBloodSugarSeries(records: BloodSugarRecordRow[]) {
  return records
    .filter((record) => record.bloodSugar > 0)
    .map((record) => ({
      datetime: record.datetime.toISOString(),
      value: record.bloodSugar
    }));
}

export function buildBloodSugarAlerts(records: BloodSugarRecordRow[]) {
  return records
    .filter((record) => record.bloodSugar > 0 && (record.bloodSugar < BLOOD_SUGAR_LOW || record.bloodSugar > BLOOD_SUGAR_HIGH))
    .slice(-10)
    .map((record) => ({
      datetime: record.datetime.toISOString(),
      bloodSugar: record.bloodSugar,
      level: record.bloodSugar < BLOOD_SUGAR_LOW ? "low" : "high",
      note: record.note
    }));
}
