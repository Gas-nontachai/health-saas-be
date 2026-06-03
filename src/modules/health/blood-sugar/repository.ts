import type { AppPrisma } from "../../../infra/prisma.js";
import type { CreateBloodSugarRecordInput, PaginationQuery, UpdateBloodSugarRecordInput } from "./schemas.js";

export async function findBloodSugarEntriesPage(prisma: AppPrisma, userId: string, query: PaginationQuery) {
  const where = { userId };
  const [records, totalCount] = await Promise.all([
    prisma.record.findMany({ where, orderBy: { datetime: "desc" }, take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) }),
    prisma.record.count({ where })
  ]);
  return { records, totalCount };
}
export async function createBloodSugarRecord(prisma: AppPrisma, userId: string, body: CreateBloodSugarRecordInput) { return prisma.record.create({ data: { userId, datetime: new Date(body.datetime), bloodSugar: body.bloodSugar, medMorning: body.medMorning, medEvening: body.medEvening, note: body.note } }); }
export async function updateBloodSugarRecord(prisma: AppPrisma, id: string, body: UpdateBloodSugarRecordInput) { return prisma.record.update({ where: { id }, data: { ...body, datetime: body.datetime ? new Date(body.datetime) : undefined } }); }
export async function deleteBloodSugarRecord(prisma: AppPrisma, id: string) { return prisma.record.delete({ where: { id } }); }
export async function findOwnedRecordId(prisma: AppPrisma, id: string, userId: string) { return prisma.record.findFirst({ where: { id, userId }, select: { id: true } }); }
export async function findBloodSugarExportData(prisma: AppPrisma, userId: string) {
  return Promise.all([
    prisma.record.findMany({ where: { userId }, orderBy: { datetime: "asc" }, take: 1000, select: { datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true } }),
    prisma.profile.findUnique({ where: { userId }, select: { weight: true, height: true } })
  ]);
}
