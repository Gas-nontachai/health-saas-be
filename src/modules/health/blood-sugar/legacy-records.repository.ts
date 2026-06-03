import type { AppPrisma } from "../../../infra/prisma.js";
import type { CreateRecordInput, PaginationQuery, UpdateRecordInput } from "./legacy-records.schemas.js";

export async function findRecordsPage(prisma: AppPrisma, userId: string, query: PaginationQuery) {
  const where = { userId };
  const [records, totalCount] = await Promise.all([
    prisma.record.findMany({ where, orderBy: { datetime: "desc" }, take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) }),
    prisma.record.count({ where })
  ]);
  return { records, totalCount };
}

export async function createRecord(prisma: AppPrisma, userId: string, body: CreateRecordInput) {
  return prisma.record.create({ data: { userId, datetime: new Date(body.datetime), bloodSugar: body.bloodSugar, medMorning: body.medMorning, medEvening: body.medEvening, note: body.note } });
}

export async function updateRecord(prisma: AppPrisma, id: string, body: UpdateRecordInput) {
  return prisma.record.update({ where: { id }, data: { ...body, datetime: body.datetime ? new Date(body.datetime) : undefined } });
}
export async function deleteRecord(prisma: AppPrisma, id: string) { return prisma.record.delete({ where: { id } }); }
export async function findOwnedRecordId(prisma: AppPrisma, id: string, userId: string) { return prisma.record.findFirst({ where: { id, userId }, select: { id: true } }); }
