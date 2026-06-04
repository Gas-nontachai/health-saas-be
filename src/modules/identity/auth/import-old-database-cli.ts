import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infra/prisma.js";

type ImportStats = {
  users: number;
  profiles: number;
  records: number;
  healthMetricEntries: number;
  healthGoals: number;
  userPreferences: number;
  sharedLinks: number;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await importOldDatabase();
  } finally {
    await prisma.$disconnect();
  }
}

export async function importOldDatabase(): Promise<void> {
  if (process.env.OLD_DATABASE_IMPORT_ON_DEPLOY !== "true") {
    console.log("Skipping old database import because OLD_DATABASE_IMPORT_ON_DEPLOY is not true.");
    return;
  }

  const oldDatabaseUrl = process.env.OLD_DATABASE_URL;
  if (!oldDatabaseUrl) {
    throw new Error("OLD_DATABASE_URL is required when OLD_DATABASE_IMPORT_ON_DEPLOY=true");
  }

  const oldPrisma = new PrismaClient({ datasources: { db: { url: oldDatabaseUrl } } });
  try {
    const stats = await importOldDatabaseData(oldPrisma, prisma);
    console.log(
      `Old database import complete. users=${stats.users} profiles=${stats.profiles} records=${stats.records} healthMetricEntries=${stats.healthMetricEntries} healthGoals=${stats.healthGoals} userPreferences=${stats.userPreferences} sharedLinks=${stats.sharedLinks}`
    );
  } finally {
    await oldPrisma.$disconnect();
  }
}

export async function importOldDatabaseData(oldPrisma: PrismaClient, targetPrisma: PrismaClient): Promise<ImportStats> {
  const stats: ImportStats = {
    users: 0,
    profiles: 0,
    records: 0,
    healthMetricEntries: 0,
    healthGoals: 0,
    userPreferences: 0,
    sharedLinks: 0
  };
  const userIdMap = new Map<string, string>();

  const oldUsers = await oldPrisma.user.findMany({ orderBy: { createdAt: "asc" } });
  for (const oldUser of oldUsers) {
    const existing = await targetPrisma.user.findFirst({
      where: {
        OR: [{ id: oldUser.id }, ...(oldUser.keycloakId ? [{ keycloakId: oldUser.keycloakId }] : []), { email: oldUser.email }]
      }
    });

    const user = existing
      ? await targetPrisma.user.update({
          where: { id: existing.id },
          data: {
            keycloakId: existing.keycloakId ?? oldUser.keycloakId,
            email: oldUser.email,
            name: oldUser.name ?? existing.name,
            passwordHash: existing.passwordHash ?? oldUser.passwordHash,
            passwordChangeRequired: existing.passwordChangeRequired || oldUser.passwordChangeRequired,
            passwordChangedAt: existing.passwordChangedAt ?? oldUser.passwordChangedAt,
            migratedFrom: existing.migratedFrom ?? oldUser.migratedFrom,
            migratedAt: existing.migratedAt ?? oldUser.migratedAt,
            temporaryPasswordSentAt: existing.temporaryPasswordSentAt ?? oldUser.temporaryPasswordSentAt
          }
        })
      : await targetPrisma.user.create({
          data: {
            id: oldUser.id,
            keycloakId: oldUser.keycloakId,
            email: oldUser.email,
            name: oldUser.name,
            passwordHash: oldUser.passwordHash,
            passwordChangeRequired: oldUser.passwordChangeRequired,
            passwordChangedAt: oldUser.passwordChangedAt,
            migratedFrom: oldUser.migratedFrom,
            migratedAt: oldUser.migratedAt,
            temporaryPasswordSentAt: oldUser.temporaryPasswordSentAt,
            createdAt: oldUser.createdAt
          }
        });

    userIdMap.set(oldUser.id, user.id);
    stats.users += 1;
  }

  for (const oldProfile of await oldPrisma.profile.findMany()) {
    const userId = userIdMap.get(oldProfile.userId);
    if (!userId) continue;
    await targetPrisma.profile.upsert({
      where: { userId },
      update: { weight: oldProfile.weight, height: oldProfile.height },
      create: { id: oldProfile.id, userId, weight: oldProfile.weight, height: oldProfile.height, createdAt: oldProfile.createdAt }
    });
    stats.profiles += 1;
  }

  for (const oldRecord of await oldPrisma.record.findMany()) {
    const userId = userIdMap.get(oldRecord.userId);
    if (!userId) continue;
    await targetPrisma.record.upsert({
      where: { id: oldRecord.id },
      update: {
        userId,
        datetime: oldRecord.datetime,
        bloodSugar: oldRecord.bloodSugar,
        medMorning: oldRecord.medMorning,
        medEvening: oldRecord.medEvening,
        note: oldRecord.note
      },
      create: { ...oldRecord, userId }
    });
    stats.records += 1;
  }

  for (const oldEntry of await oldPrisma.healthMetricEntry.findMany()) {
    const userId = userIdMap.get(oldEntry.userId);
    if (!userId) continue;
    await targetPrisma.healthMetricEntry.upsert({
      where: { id: oldEntry.id },
      update: {
        userId,
        metricType: oldEntry.metricType,
        date: oldEntry.date,
        value: oldEntry.value,
        updatedAt: oldEntry.updatedAt
      },
      create: { ...oldEntry, userId }
    });
    stats.healthMetricEntries += 1;
  }

  for (const oldGoal of await oldPrisma.healthGoal.findMany()) {
    const userId = userIdMap.get(oldGoal.userId);
    if (!userId) continue;
    await targetPrisma.healthGoal.upsert({
      where: { id: oldGoal.id },
      update: {
        userId,
        metricType: oldGoal.metricType,
        startDate: oldGoal.startDate,
        targetDate: oldGoal.targetDate,
        startValue: oldGoal.startValue,
        targetValue: oldGoal.targetValue,
        updatedAt: oldGoal.updatedAt
      },
      create: { ...oldGoal, userId }
    });
    stats.healthGoals += 1;
  }

  for (const oldPreference of await oldPrisma.userPreference.findMany()) {
    const userId = userIdMap.get(oldPreference.userId);
    if (!userId) continue;
    const dashboardWidgets = jsonOrFallback(oldPreference.dashboardWidgets, []);
    await targetPrisma.userPreference.upsert({
      where: { userId },
      update: { dashboardWidgets },
      create: { id: oldPreference.id, userId, dashboardWidgets, createdAt: oldPreference.createdAt, updatedAt: oldPreference.updatedAt }
    });
    stats.userPreferences += 1;
  }

  for (const oldSharedLink of await oldPrisma.sharedLink.findMany()) {
    const userId = userIdMap.get(oldSharedLink.userId);
    if (!userId) continue;
    const dataTypes = jsonOrFallback(oldSharedLink.dataTypes, ["bloodSugar"]);
    await targetPrisma.sharedLink.upsert({
      where: { id: oldSharedLink.id },
      update: {
        userId,
        tokenHash: oldSharedLink.tokenHash,
        publicToken: oldSharedLink.publicToken,
        dataStartAt: oldSharedLink.dataStartAt,
        dataEndAt: oldSharedLink.dataEndAt,
        dataTypes,
        expiresAt: oldSharedLink.expiresAt,
        revokedAt: oldSharedLink.revokedAt,
        updatedAt: oldSharedLink.updatedAt
      },
      create: { ...oldSharedLink, userId, dataTypes }
    });
    stats.sharedLinks += 1;
  }

  return stats;
}

function jsonOrFallback(value: Prisma.JsonValue, fallback: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return value === null ? fallback : (value as Prisma.InputJsonValue);
}
