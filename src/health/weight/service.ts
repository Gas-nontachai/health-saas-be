import type { AppPrisma } from "../../prisma.js";
import {
  buildForecastSeries,
  buildRollingAverageSeries,
  calculateEta,
  calculateProgressPercent,
  calculateTrend,
  compareWithForecast,
  formatDate,
  getRangeStart,
  getVisibleForecastStart,
  interpolateForecast,
  round1,
  serializeGoal,
  serializeMetricEntry,
  todayUtc,
  WEIGHT_METRIC_TYPE,
  type GoalRow,
  type MetricEntryRow
} from "./forecast.js";

export async function upsertWeightEntryAndSyncProfile(prisma: AppPrisma, userId: string, date: Date, value: number) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.healthMetricEntry.upsert({
      where: {
        userId_metricType_date: {
          userId,
          metricType: WEIGHT_METRIC_TYPE,
          date
        }
      },
      update: { value },
      create: {
        userId,
        metricType: WEIGHT_METRIC_TYPE,
        date,
        value
      }
    });

    const latestEntry = await tx.healthMetricEntry.findFirst({
      where: { userId, metricType: WEIGHT_METRIC_TYPE },
      orderBy: { date: "desc" }
    });

    await tx.profile.upsert({
      where: { userId },
      update: { weight: latestEntry?.value ?? value },
      create: { userId, weight: latestEntry?.value ?? value }
    });

    return entry;
  });
}

export async function findWeightGoal(prisma: AppPrisma, userId: string) {
  return prisma.healthGoal.findUnique({
    where: {
      userId_metricType: {
        userId,
        metricType: WEIGHT_METRIC_TYPE
      }
    }
  });
}

export async function findWeightEntries(prisma: AppPrisma, userId: string, range: "7d" | "30d" | "all", now = todayUtc()) {
  const rangeStart = getRangeStart(range, now);
  return prisma.healthMetricEntry.findMany({
    where: {
      userId,
      metricType: WEIGHT_METRIC_TYPE,
      ...(rangeStart ? { date: { gte: rangeStart } } : {})
    },
    orderBy: { date: "asc" }
  });
}

export async function findAllWeightEntriesForExport(prisma: AppPrisma, userId: string) {
  return prisma.healthMetricEntry.findMany({
    where: { userId, metricType: WEIGHT_METRIC_TYPE },
    orderBy: { date: "asc" },
    take: 1000
  });
}

export function buildWeightForecastResponse(range: "7d" | "30d" | "all", goal: GoalRow | null, entries: MetricEntryRow[], now = todayUtc()) {
  if (!goal) {
    return {
      range,
      metricType: WEIGHT_METRIC_TYPE,
      status: "insufficient_data",
      message: "Weight goal is required to calculate forecast",
      goal: null,
      cards: null,
      series: emptySeries()
    };
  }

  if (entries.length === 0) {
    return {
      range,
      metricType: WEIGHT_METRIC_TYPE,
      status: "insufficient_data",
      message: "At least one weight entry is required to compare actual progress",
      goal: serializeGoal(goal),
      cards: null,
      series: {
        ...emptySeries(),
        forecast: buildForecastSeries(goal, getVisibleForecastStart(goal, range, now), goal.targetDate)
      }
    };
  }

  const latest = entries[entries.length - 1];
  const totalChange = latest.value - entries[0].value;
  const min = Math.min(...entries.map((entry) => entry.value));
  const max = Math.max(...entries.map((entry) => entry.value));
  const trend = calculateTrend(entries);
  const forecastValue = interpolateForecast(goal, latest.date);

  return {
    range,
    metricType: WEIGHT_METRIC_TYPE,
    status: compareWithForecast(goal, latest.value, forecastValue),
    goal: serializeGoal(goal),
    cards: {
      currentValue: round1(latest.value),
      lowestValue: round1(min),
      highestValue: round1(max),
      totalChange: round1(totalChange),
      trendKgPerWeek: trend.status === "ok" ? round1(trend.kgPerWeek) : null,
      eta: calculateEta(goal, latest, trend.kgPerWeek),
      targetProgress: {
        percent: calculateProgressPercent(goal, latest.value),
        remainingValue: round1(goal.targetValue - latest.value)
      },
      forecastComparison: {
        date: formatDate(latest.date),
        forecastValue: round1(forecastValue),
        delta: round1(latest.value - forecastValue)
      }
    },
    series: {
      actual: entries.map((entry) => ({ date: formatDate(entry.date), value: round1(entry.value) })),
      rollingAverage: buildRollingAverageSeries(entries),
      forecast: buildForecastSeries(goal, getVisibleForecastStart(goal, range, now), goal.targetDate)
    }
  };
}

export function buildWeightSummary(goal: GoalRow | null, entries: MetricEntryRow[]) {
  const forecast = buildWeightForecastResponse("all", goal, entries);
  return {
    status: forecast.status,
    goal: forecast.goal,
    cards: forecast.cards
  };
}

export function serializeWeightEntries(entries: MetricEntryRow[]) {
  return entries.map(serializeMetricEntry);
}

function emptySeries() {
  return {
    actual: [],
    rollingAverage: [],
    forecast: []
  };
}
