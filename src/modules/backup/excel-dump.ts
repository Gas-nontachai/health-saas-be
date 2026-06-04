import ExcelJS from "exceljs";
import type { AppPrisma } from "../../infra/prisma.js";

type SheetDefinition = {
  name: string;
  columns: Array<{ key: string; header: string }>;
  loadRows: (prisma: AppPrisma) => Promise<Array<Record<string, unknown>>>;
};

export async function createDatabaseWorkbook(prisma: AppPrisma, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Health SaaS Backup";
  workbook.created = new Date();

  for (const sheet of getSheetDefinitions()) {
    const rows = await sheet.loadRows(prisma);
    writeSheet(workbook, sheet, rows);
  }

  await workbook.xlsx.writeFile(outputPath);
}

function getSheetDefinitions(): SheetDefinition[] {
  return [
    {
      name: "users",
      columns: columns("id", "keycloakId", "email", "name", "passwordChangeRequired", "passwordChangedAt", "migratedFrom", "migratedAt", "temporaryPasswordSentAt", "createdAt"),
      loadRows: (prisma) =>
        prisma.user.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            keycloakId: true,
            email: true,
            name: true,
            passwordChangeRequired: true,
            passwordChangedAt: true,
            migratedFrom: true,
            migratedAt: true,
            temporaryPasswordSentAt: true,
            createdAt: true
          }
        })
    },
    {
      name: "profiles",
      columns: columns("id", "userId", "weight", "height", "createdAt"),
      loadRows: (prisma) => prisma.profile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, userId: true, weight: true, height: true, createdAt: true } })
    },
    {
      name: "user_preferences",
      columns: columns("id", "userId", "dashboardWidgets", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.userPreference.findMany({
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true, dashboardWidgets: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "blood_sugar_logs",
      columns: columns("id", "userId", "datetime", "bloodSugar", "medMorning", "medEvening", "note", "createdAt"),
      loadRows: (prisma) =>
        prisma.record.findMany({
          orderBy: { datetime: "asc" },
          select: { id: true, userId: true, datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true, createdAt: true }
        })
    },
    {
      name: "weight_logs",
      columns: columns("id", "userId", "metricType", "date", "value", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.healthMetricEntry.findMany({
          orderBy: [{ metricType: "asc" }, { date: "asc" }],
          select: { id: true, userId: true, metricType: true, date: true, value: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "health_goals",
      columns: columns("id", "userId", "metricType", "startDate", "targetDate", "startValue", "targetValue", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.healthGoal.findMany({
          orderBy: [{ metricType: "asc" }, { createdAt: "asc" }],
          select: { id: true, userId: true, metricType: true, startDate: true, targetDate: true, startValue: true, targetValue: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "shared_links",
      columns: columns("id", "userId", "dataStartAt", "dataEndAt", "dataTypes", "expiresAt", "revokedAt", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.sharedLink.findMany({
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true, dataStartAt: true, dataEndAt: true, dataTypes: true, expiresAt: true, revokedAt: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "roles",
      columns: columns("id", "name", "description", "isSystem", "isActive", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.role.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, isSystem: true, isActive: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "permissions",
      columns: columns("id", "code", "category", "categoryLabel", "action", "scope", "label", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.permission.findMany({
          orderBy: { code: "asc" },
          select: { id: true, code: true, category: true, categoryLabel: true, action: true, scope: true, label: true, createdAt: true, updatedAt: true }
        })
    },
    {
      name: "role_permissions",
      columns: columns("roleId", "permissionId", "createdAt"),
      loadRows: (prisma) => prisma.rolePermission.findMany({ orderBy: [{ roleId: "asc" }, { permissionId: "asc" }], select: { roleId: true, permissionId: true, createdAt: true } })
    },
    {
      name: "user_roles",
      columns: columns("userId", "roleId", "createdAt"),
      loadRows: (prisma) => prisma.userRole.findMany({ orderBy: [{ userId: "asc" }, { roleId: "asc" }], select: { userId: true, roleId: true, createdAt: true } })
    },
    {
      name: "password_reset_otps",
      columns: columns("id", "email", "expiresAt", "attempts", "consumedAt", "createdAt"),
      loadRows: (prisma) =>
        prisma.passwordResetOtp.findMany({
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true, expiresAt: true, attempts: true, consumedAt: true, createdAt: true }
        })
    },
    {
      name: "backup_logs",
      columns: columns("id", "status", "triggerType", "fileName", "fileSize", "storageObjectPath", "startedAt", "finishedAt", "errorMessage", "createdBy", "createdAt", "updatedAt"),
      loadRows: (prisma) =>
        prisma.backupLog.findMany({
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            status: true,
            triggerType: true,
            fileName: true,
            fileSize: true,
            storageObjectPath: true,
            startedAt: true,
            finishedAt: true,
            errorMessage: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true
          }
        })
    }
  ];
}

function columns(...keys: string[]) {
  return keys.map((key) => ({ key, header: key }));
}

function writeSheet(workbook: ExcelJS.Workbook, definition: SheetDefinition, rows: Array<Record<string, unknown>>): void {
  const worksheet = workbook.addWorksheet(definition.name.slice(0, 31));
  worksheet.columns = definition.columns.map((column) => ({ ...column, width: Math.max(column.header.length + 2, 14) }));
  worksheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    worksheet.addRow(formatRow(row));
  }
}

function formatRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, formatValue(value)]));
}

function formatValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
