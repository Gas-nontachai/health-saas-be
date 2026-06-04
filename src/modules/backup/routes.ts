import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/index.js";
import type { AppPrisma } from "../../infra/prisma.js";
import { HttpError } from "../../common/errors.js";
import { requirePermission } from "../identity/rbac/authorize.js";
import { backupLogsQuerySchema } from "./schemas.js";
import { createBackupService, type BackupService } from "./service.js";

export async function registerBackupRoutes(app: FastifyInstance, config: AppConfig, prisma: AppPrisma, backupService?: BackupService): Promise<void> {
  const service = backupService ?? createBackupService(config, prisma);

  app.post("/internal/backup/run", async (request, reply) => {
    assertBackupSecret(config.BACKUP_CRON_SECRET, request.headers["x-backup-secret"]);
    const result = await service.runBackup({ triggerType: "scheduled" });
    reply.status(result.status === "failed" ? 500 : 200);
    return result;
  });

  app.post("/backoffice/backups/run", { preHandler: [app.authenticate, requirePermission("backups.create.system")] }, async (request, reply) => {
    const result = await service.runBackup({ triggerType: "manual", createdBy: request.user.id });
    reply.status(result.status === "failed" ? 500 : 200);
    return result;
  });

  app.get("/backoffice/backups", { preHandler: [app.authenticate, requirePermission("backups.read.system")] }, async (request) => {
    const query = backupLogsQuerySchema.parse(request.query);
    return service.listLogs(query);
  });
}

function assertBackupSecret(expectedSecret: string | undefined, headerValue: string | string[] | undefined): void {
  if (!expectedSecret) {
    throw new HttpError(500, "BACKUP_CRON_SECRET is required for scheduled backup");
  }

  const actualSecret = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!actualSecret || !safeEqual(actualSecret, expectedSecret)) {
    throw new HttpError(401, "Unauthorized");
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
