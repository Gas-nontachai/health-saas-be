import type { AppPrisma } from "../../infra/prisma.js";
import type { BackupLogsQuery } from "./schemas.js";
import type { BackupStatus, BackupTriggerType } from "./types.js";

export type BackupLogUpdate = {
  status?: BackupStatus;
  fileName?: string | null;
  fileSize?: number | null;
  storageObjectPath?: string | null;
  finishedAt?: Date | null;
  errorMessage?: string | null;
};

export async function findRunningBackup(prisma: AppPrisma) {
  return prisma.backupLog.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" }
  });
}

export async function createBackupLog(prisma: AppPrisma, input: { triggerType: BackupTriggerType; createdBy?: string | null; startedAt: Date }) {
  return prisma.backupLog.create({
    data: {
      status: "running",
      triggerType: input.triggerType,
      createdBy: input.createdBy ?? null,
      startedAt: input.startedAt
    }
  });
}

export async function updateBackupLog(prisma: AppPrisma, id: string, data: BackupLogUpdate) {
  return prisma.backupLog.update({
    where: { id },
    data
  });
}

export async function listBackupLogs(prisma: AppPrisma, query: BackupLogsQuery) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.triggerType ? { triggerType: query.triggerType } : {})
  };
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    prisma.backupLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: query.limit
    }),
    prisma.backupLog.count({ where })
  ]);

  return { items, total };
}
