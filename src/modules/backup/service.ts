import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/index.js";
import type { AppPrisma } from "../../infra/prisma.js";
import { HttpError } from "../../common/errors.js";
import { createBackupLog, findRunningBackup, listBackupLogs, updateBackupLog } from "./repository.js";
import type { BackupLogsQuery } from "./schemas.js";
import { serializeBackupLog } from "./serializer.js";
import type { BackupManifest, BackupRunResult, BackupTriggerType } from "./types.js";
import { createDatabaseWorkbook } from "./excel-dump.js";
import { uploadBackupZipToGoogleDrive } from "./google-drive.js";
import { createPostgresDump } from "./sql-dump.js";
import { createBackupZip } from "./zip.js";

export type BackupService = {
  runBackup(input: { triggerType: BackupTriggerType; createdBy?: string | null }): Promise<BackupRunResult>;
  listLogs(query: BackupLogsQuery): Promise<{ items: ReturnType<typeof serializeBackupLog>[]; page: number; limit: number; total: number }>;
};

export type BackupServiceDependencies = {
  createSqlDump?: (databaseUrl: string, outputPath: string) => Promise<void>;
  createExcelDump?: (prisma: AppPrisma, outputPath: string) => Promise<void>;
  createZip?: (zipPath: string, files: Array<{ path: string; name: string }>) => Promise<void>;
  uploadZip?: (zipPath: string, fileName: string) => Promise<string>;
  now?: () => Date;
};

export function createBackupService(config: AppConfig, prisma: AppPrisma, dependencies: BackupServiceDependencies = {}): BackupService {
  const createSqlDump = dependencies.createSqlDump ?? createPostgresDump;
  const createExcelDump = dependencies.createExcelDump ?? createDatabaseWorkbook;
  const createZip = dependencies.createZip ?? createBackupZip;
  const uploadZip =
    dependencies.uploadZip ??
    ((zipPath, fileName) =>
      uploadBackupZipToGoogleDrive(
        {
          folderId: requiredConfig(config.GOOGLE_DRIVE_FOLDER_ID, "GOOGLE_DRIVE_FOLDER_ID"),
          serviceAccountEmail: requiredConfig(config.GOOGLE_SERVICE_ACCOUNT_EMAIL, "GOOGLE_SERVICE_ACCOUNT_EMAIL"),
          privateKey: requiredConfig(config.GOOGLE_PRIVATE_KEY, "GOOGLE_PRIVATE_KEY")
        },
        zipPath,
        fileName
      ));
  const now = dependencies.now ?? (() => new Date());

  return {
    async runBackup(input) {
      const running = await findRunningBackup(prisma);
      if (running) return { message: "Backup is already running", status: "running" };

      const startedAt = now();
      const log = await createBackupLog(prisma, { triggerType: input.triggerType, createdBy: input.createdBy, startedAt });
      const fileName = buildBackupFileName(startedAt);
      const runDir = path.join(config.BACKUP_TEMP_DIR, log.id);
      const sqlPath = path.join(runDir, "database.sql");
      const excelPath = path.join(runDir, "database.xlsx");
      const manifestPath = path.join(runDir, "manifest.json");
      const zipPath = path.join(runDir, fileName);

      try {
        ensureBackupInputs(config);
        await mkdir(runDir, { recursive: true });

        const zipFiles: Array<{ path: string; name: string }> = [];
        const manifestFiles: BackupManifest["files"] = [];

        if (config.BACKUP_INCLUDE_SQL) {
          await createSqlDump(config.DATABASE_URL, sqlPath);
          zipFiles.push({ path: sqlPath, name: "database.sql" });
          manifestFiles.push({ name: "database.sql", type: "sql_dump" });
        }

        if (config.BACKUP_INCLUDE_EXCEL) {
          await createExcelDump(prisma, excelPath);
          zipFiles.push({ path: excelPath, name: "database.xlsx" });
          manifestFiles.push({ name: "database.xlsx", type: "excel_export" });
        }

        const manifest: BackupManifest = {
          backupAt: startedAt.toISOString(),
          environment: config.BACKUP_ENVIRONMENT,
          type: input.triggerType,
          databaseProvider: "postgresql",
          files: manifestFiles,
          status: "success"
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        zipFiles.push({ path: manifestPath, name: "manifest.json" });

        await createZip(zipPath, zipFiles);
        const googleDriveFileId = await uploadZip(zipPath, fileName);
        const zipStats = await stat(zipPath);

        await updateBackupLog(prisma, log.id, {
          status: "success",
          fileName,
          fileSize: zipStats.size,
          googleDriveFileId,
          finishedAt: now(),
          errorMessage: null
        });

        return {
          message: input.triggerType === "manual" ? "Manual backup completed successfully" : "Backup completed successfully",
          backupId: log.id,
          fileName,
          status: "success"
        };
      } catch (error) {
        const sanitizedError = sanitizeBackupError(error, config);
        await updateBackupLog(prisma, log.id, {
          status: "failed",
          fileName,
          finishedAt: now(),
          errorMessage: sanitizedError
        });
        return { message: "Backup failed", backupId: log.id, status: "failed", error: sanitizedError };
      } finally {
        await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async listLogs(query) {
      const result = await listBackupLogs(prisma, query);
      return {
        items: result.items.map(serializeBackupLog),
        page: query.page,
        limit: query.limit,
        total: result.total
      };
    }
  };
}

function ensureBackupInputs(config: AppConfig): void {
  if (!config.BACKUP_INCLUDE_SQL && !config.BACKUP_INCLUDE_EXCEL) {
    throw new HttpError(500, "At least one backup output must be enabled");
  }
  requiredConfig(config.GOOGLE_DRIVE_FOLDER_ID, "GOOGLE_DRIVE_FOLDER_ID");
  requiredConfig(config.GOOGLE_SERVICE_ACCOUNT_EMAIL, "GOOGLE_SERVICE_ACCOUNT_EMAIL");
  requiredConfig(config.GOOGLE_PRIVATE_KEY, "GOOGLE_PRIVATE_KEY");
}

function requiredConfig(value: string | undefined, name: string): string {
  if (!value) throw new HttpError(500, `${name} is required for database backup`);
  return value;
}

function buildBackupFileName(date: Date): string {
  const iso = date.toISOString();
  return `backup_${iso.slice(0, 10)}_${iso.slice(11, 16).replace(":", "")}.zip`;
}

function sanitizeBackupError(error: unknown, config: AppConfig): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown backup error";
  const withoutDatabaseUrl = raw.replaceAll(config.DATABASE_URL, "[DATABASE_URL]");
  return withoutDatabaseUrl.replace(/\s+/g, " ").trim().slice(0, 500) || "Backup failed";
}
