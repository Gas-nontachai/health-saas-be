import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/index.js";
import type { AppPrisma } from "../src/infra/prisma.js";
import { createDatabaseWorkbook } from "../src/modules/backup/excel-dump.js";
import { createBackupService, type BackupService } from "../src/modules/backup/service.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/blood_sugar",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-for-local-auth",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  KEYCLOAK_USER_MIGRATION_ON_DEPLOY: false,
  KEYCLOAK_USER_MIGRATION_FORCE_EMAIL: false,
  RESET_OTP_SECRET: "test-reset-otp-secret-that-is-long-enough",
  INITIAL_ADMIN_BOOTSTRAP_ON_START: false,
  RBAC_SYNC_ON_START: false,
  BACKUP_CRON_SECRET: "test-backup-secret",
  BACKUP_TEMP_DIR: path.join(os.tmpdir(), "health-saas-backup-tests"),
  BACKUP_ENVIRONMENT: "test",
  BACKUP_INCLUDE_EXCEL: true,
  BACKUP_INCLUDE_SQL: true,
  GOOGLE_DRIVE_FOLDER_ID: "test-folder",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "backup@example.com",
  GOOGLE_PRIVATE_KEY: "test-private-key"
};

function mockAuth(userId = "admin-1", permissions: string[] = ["backups.read.system", "backups.create.system"]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    request.user = {
      id: userId,
      keycloakId: null,
      email: "admin@example.com",
      name: "Admin",
      roles: ["Admin"],
      permissions,
      passwordChangeRequired: false
    };
  };
}

function mockPrisma(overrides: Partial<AppPrisma> = {}): AppPrisma {
  const now = new Date("2026-06-04T02:00:00.000Z");
  return {
    backupLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(mockBackupLog({ startedAt: now })),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([mockBackupLog({ startedAt: now })]),
      count: vi.fn().mockResolvedValue(1)
    },
    ...excelPrismaDelegates(),
    ...overrides
  } as unknown as AppPrisma;
}

function mockBackupLog(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-04T02:00:00.000Z");
  return {
    id: "backup-001",
    status: "running",
    triggerType: "scheduled",
    fileName: null,
    fileSize: null,
    googleDriveFileId: null,
    startedAt: now,
    finishedAt: null,
    errorMessage: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function mockBackupService(overrides: Partial<BackupService> = {}): BackupService {
  return {
    runBackup: vi.fn().mockResolvedValue({
      message: "Backup completed successfully",
      backupId: "backup-001",
      fileName: "backup_2026-06-04_0200.zip",
      status: "success"
    }),
    listLogs: vi.fn().mockResolvedValue({
      items: [mockBackupLog({ status: "success", fileName: "backup_2026-06-04_0200.zip" })],
      page: 1,
      limit: 20,
      total: 1
    }),
    ...overrides
  };
}

function excelPrismaDelegates() {
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    user: { findMany },
    profile: { findMany },
    userPreference: { findMany },
    record: { findMany },
    healthMetricEntry: { findMany },
    healthGoal: { findMany },
    sharedLink: { findMany },
    role: { findMany },
    permission: { findMany },
    rolePermission: { findMany },
    userRole: { findMany },
    passwordResetOtp: { findMany }
  };
}

describe("backup routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid cron secrets without creating a backup log", async () => {
    const service = mockBackupService();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), backupService: service, logger: false });

    const response = await app.inject({ method: "POST", url: "/internal/backup/run", headers: { "x-backup-secret": "wrong" } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: "Unauthorized" });
    expect(service.runBackup).not.toHaveBeenCalled();
    await app.close();
  });

  it("runs scheduled backups with the cron secret", async () => {
    const service = mockBackupService();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth(), backupService: service, logger: false });

    const response = await app.inject({ method: "POST", url: "/internal/backup/run", headers: { "x-backup-secret": "test-backup-secret" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ backupId: "backup-001", status: "success" });
    expect(service.runBackup).toHaveBeenCalledWith({ triggerType: "scheduled" });
    await app.close();
  });

  it("requires backup create permission for manual runs", async () => {
    const service = mockBackupService();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("admin-1", []), backupService: service, logger: false });

    const response = await app.inject({ method: "POST", url: "/backoffice/backups/run" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "Permission denied: backups.create.system" });
    expect(service.runBackup).not.toHaveBeenCalled();
    await app.close();
  });

  it("runs manual backups with createdBy", async () => {
    const service = mockBackupService();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("admin-1"), backupService: service, logger: false });

    const response = await app.inject({ method: "POST", url: "/backoffice/backups/run" });

    expect(response.statusCode).toBe(200);
    expect(service.runBackup).toHaveBeenCalledWith({ triggerType: "manual", createdBy: "admin-1" });
    await app.close();
  });

  it("lists backup logs with pagination filters", async () => {
    const service = mockBackupService();
    const app = await buildApp({ config, prisma: mockPrisma(), authenticate: mockAuth("admin-1"), backupService: service, logger: false });

    const response = await app.inject({ method: "GET", url: "/backoffice/backups?page=2&limit=10&status=success&triggerType=scheduled" });

    expect(response.statusCode).toBe(200);
    expect(service.listLogs).toHaveBeenCalledWith({ page: 2, limit: 10, status: "success", triggerType: "scheduled" });
    await app.close();
  });
});

describe("backup service", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(config.BACKUP_TEMP_DIR, { recursive: true, force: true });
  });

  it("creates SQL, Excel, manifest, zip, upload, and success log", async () => {
    const prisma = mockPrisma();
    const service = createBackupService(config, prisma, {
      now: () => new Date("2026-06-04T02:00:00.000Z"),
      createSqlDump: vi.fn(async (_databaseUrl, outputPath) => writeFile(outputPath, "-- sql")),
      createExcelDump: vi.fn(async (_prisma, outputPath) => writeFile(outputPath, "excel")),
      createZip: vi.fn(async (zipPath) => writeFile(zipPath, "zip")),
      uploadZip: vi.fn().mockResolvedValue("drive-file-1")
    });

    const result = await service.runBackup({ triggerType: "scheduled" });

    expect(result).toEqual({
      message: "Backup completed successfully",
      backupId: "backup-001",
      fileName: "backup_2026-06-04_0200.zip",
      status: "success"
    });
    expect(prisma.backupLog.update).toHaveBeenCalledWith({
      where: { id: "backup-001" },
      data: expect.objectContaining({
        status: "success",
        fileName: "backup_2026-06-04_0200.zip",
        fileSize: 3,
        googleDriveFileId: "drive-file-1",
        errorMessage: null
      })
    });
  });

  it("updates failed logs with sanitized errors", async () => {
    const prisma = mockPrisma();
    const service = createBackupService(config, prisma, {
      now: () => new Date("2026-06-04T02:00:00.000Z"),
      createSqlDump: vi.fn(async () => {
        throw new Error(`pg_dump failed for ${config.DATABASE_URL}`);
      })
    });

    const result = await service.runBackup({ triggerType: "manual", createdBy: "admin-1" });

    expect(result).toMatchObject({ backupId: "backup-001", status: "failed", error: "pg_dump failed for [DATABASE_URL]" });
    expect(prisma.backupLog.update).toHaveBeenCalledWith({
      where: { id: "backup-001" },
      data: expect.objectContaining({
        status: "failed",
        fileName: "backup_2026-06-04_0200.zip",
        errorMessage: "pg_dump failed for [DATABASE_URL]"
      })
    });
  });

  it("does not start a new run when another backup is running", async () => {
    const prisma = mockPrisma({
      backupLog: {
        findFirst: vi.fn().mockResolvedValue(mockBackupLog()),
        create: vi.fn()
      }
    } as unknown as Partial<AppPrisma>);
    const service = createBackupService(config, prisma);

    const result = await service.runBackup({ triggerType: "scheduled" });

    expect(result).toEqual({ message: "Backup is already running", status: "running" });
    expect(prisma.backupLog.create).not.toHaveBeenCalled();
  });

  it("serializes paginated backup logs", async () => {
    const prisma = mockPrisma({
      backupLog: {
        findMany: vi.fn().mockResolvedValue([mockBackupLog({ status: "success", finishedAt: new Date("2026-06-04T02:00:10.000Z") })]),
        count: vi.fn().mockResolvedValue(1)
      }
    } as unknown as Partial<AppPrisma>);
    const service = createBackupService(config, prisma);

    const result = await service.listLogs({ page: 1, limit: 20, status: "success", triggerType: "scheduled" });

    expect(result).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      items: [expect.objectContaining({ id: "backup-001", status: "success", finishedAt: "2026-06-04T02:00:10.000Z" })]
    });
  });
});

describe("backup Excel dump", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("uses whitelisted headers and excludes sensitive fields", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "health-saas-backup-excel-"));
    const outputPath = path.join(tempDir, "database.xlsx");
    const prisma = mockPrisma({
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "user-1",
            email: "user@example.com",
            name: "User",
            passwordHash: "must-not-export",
            createdAt: new Date("2026-06-04T00:00:00.000Z")
          }
        ])
      },
      sharedLink: {
        findMany: vi.fn().mockResolvedValue([{ id: "link-1", userId: "user-1", tokenHash: "secret", publicToken: "secret", createdAt: new Date() }])
      },
      passwordResetOtp: {
        findMany: vi.fn().mockResolvedValue([{ id: "otp-1", email: "user@example.com", otpHash: "secret", createdAt: new Date() }])
      }
    } as unknown as Partial<AppPrisma>);

    await createDatabaseWorkbook(prisma, outputPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(outputPath));
    const allHeaders = workbook.worksheets.flatMap((worksheet) => (worksheet.getRow(1).values as unknown[]).slice(1).map(String));

    expect(allHeaders).not.toEqual(expect.arrayContaining(["passwordHash", "tokenHash", "publicToken", "otpHash"]));
    expect(workbook.getWorksheet("users")?.getRow(1).values).toContain("email");
    await rm(tempDir, { recursive: true, force: true });
  });
});
