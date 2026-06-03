import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import { createRecord, deleteRecord, findOwnedRecordId, findRecordsPage, updateRecord } from "./legacy-records.repository.js";
import type { CreateRecordInput, PaginationQuery, UpdateRecordInput } from "./legacy-records.schemas.js";

export async function listRecords(prisma: AppPrisma, userId: string, query: PaginationQuery) {
  const { records, totalCount } = await findRecordsPage(prisma, userId, query);
  const hasMore = records.length > query.limit;
  if (hasMore) records.pop();
  return { data: records, nextCursor: hasMore ? records[records.length - 1].id : null, totalCount };
}
export async function createUserRecord(prisma: AppPrisma, userId: string, body: CreateRecordInput) { return createRecord(prisma, userId, body); }
export async function updateUserRecord(prisma: AppPrisma, userId: string, id: string, body: UpdateRecordInput) { await assertRecordOwnership(prisma, id, userId); return updateRecord(prisma, id, body); }
export async function deleteUserRecord(prisma: AppPrisma, userId: string, id: string) { await assertRecordOwnership(prisma, id, userId); await deleteRecord(prisma, id); }
async function assertRecordOwnership(prisma: AppPrisma, id: string, userId: string): Promise<void> { if (!(await findOwnedRecordId(prisma, id, userId))) throw new HttpError(404, "Record not found"); }
