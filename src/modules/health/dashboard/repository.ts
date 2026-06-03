import type { AppPrisma } from "../../../infra/prisma.js";
import { getDatetimeFilter, type ProfileRow, type RecordRow } from "./widgets.js";
import type { WidgetKey } from "./constants.js";

const recordSelect = {
  datetime: true,
  bloodSugar: true,
  medMorning: true,
  medEvening: true,
  note: true
} as const;

export async function findDashboardPreference(prisma: AppPrisma, userId: string) {
  return prisma.userPreference.findUnique({
    where: { userId },
    select: { dashboardWidgets: true }
  });
}

export async function saveDashboardPreference(prisma: AppPrisma, userId: string, widgets: WidgetKey[]) {
  return prisma.userPreference.upsert({
    where: { userId },
    update: { dashboardWidgets: widgets },
    create: { userId, dashboardWidgets: widgets }
  });
}

export async function findDashboardData(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", requestedWidgets: WidgetKey[], now: Date): Promise<{ currentRecords: RecordRow[]; comparisonRecords: RecordRow[]; profile: ProfileRow }> {
  const needsPeriodComparison = requestedWidgets.includes("periodComparison") && range !== "all";
  const datetimeFilter = getDatetimeFilter(range, 1, now);
  const where = {
    userId,
    ...(datetimeFilter ? { datetime: datetimeFilter } : {})
  };

  const [currentRecords, comparisonRecords, profile] = await Promise.all([
    prisma.record.findMany({
      where,
      orderBy: { datetime: "asc" },
      select: recordSelect
    }),
    needsPeriodComparison
      ? prisma.record.findMany({
          where: {
            userId,
            datetime: getDatetimeFilter(range, 2, now)
          },
          orderBy: { datetime: "asc" },
          select: recordSelect
        })
      : Promise.resolve([]),
    prisma.profile.findUnique({
      where: { userId },
      select: { weight: true, height: true }
    })
  ]);

  return { currentRecords, comparisonRecords, profile };
}
