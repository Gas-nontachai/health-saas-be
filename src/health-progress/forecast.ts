export const WEIGHT_METRIC_TYPE = "weight_kg";
export const STATUS_TOLERANCE_KG = 0.5;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MetricEntryRow = {
  id: string;
  date: Date;
  value: number;
  createdAt: Date;
  updatedAt: Date;
};

export type GoalRow = {
  id: string;
  startDate: Date;
  targetDate: Date;
  startValue: number;
  targetValue: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProgressStatus = "ahead" | "on_track" | "behind";

export type EtaResult =
  | {
      status: "ok";
      daysRemaining: number;
      weeksRemaining: number;
      estimatedDate: string;
    }
  | {
      status: "not_progressing";
      daysRemaining: null;
      weeksRemaining: null;
      estimatedDate: null;
    };

export function serializeMetricEntry(entry: MetricEntryRow) {
  return {
    id: entry.id,
    metricType: WEIGHT_METRIC_TYPE,
    date: formatDate(entry.date),
    value: round1(entry.value),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString()
  };
}

export function serializeGoal(goal: GoalRow) {
  return {
    id: goal.id,
    metricType: WEIGHT_METRIC_TYPE,
    startDate: formatDate(goal.startDate),
    targetDate: formatDate(goal.targetDate),
    startValue: round1(goal.startValue),
    targetValue: round1(goal.targetValue),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString()
  };
}

export function buildRollingAverageSeries(entries: MetricEntryRow[]) {
  return entries.map((entry, index) => {
    const window = entries.slice(Math.max(0, index - 6), index + 1);
    const avg = window.reduce((sum, current) => sum + current.value, 0) / window.length;
    return {
      date: formatDate(entry.date),
      value: round1(avg)
    };
  });
}

export function buildForecastSeries(goal: GoalRow, start: Date, end: Date) {
  const series: Array<{ date: string; value: number }> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    series.push({
      date: formatDate(cursor),
      value: round1(interpolateForecast(goal, cursor))
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
}

export function calculateTrend(entries: MetricEntryRow[]): { status: "ok"; kgPerWeek: number } | { status: "insufficient_data"; kgPerWeek: null } {
  if (entries.length < 3) {
    return { status: "insufficient_data", kgPerWeek: null };
  }

  const recent = entries.slice(-14);
  const firstDate = recent[0].date;
  const points = recent.map((entry) => ({
    x: daysBetween(firstDate, entry.date),
    y: entry.value
  }));
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;

  for (const point of points) {
    numerator += (point.x - xMean) * (point.y - yMean);
    denominator += (point.x - xMean) ** 2;
  }

  if (denominator === 0) {
    return { status: "insufficient_data", kgPerWeek: null };
  }

  return { status: "ok", kgPerWeek: (numerator / denominator) * 7 };
}

export function calculateEta(goal: GoalRow, latest: MetricEntryRow, kgPerWeek: number | null): EtaResult {
  if (kgPerWeek === null || kgPerWeek === 0) {
    return { status: "not_progressing", daysRemaining: null, weeksRemaining: null, estimatedDate: null };
  }

  const dailyRate = kgPerWeek / 7;
  const remaining = goal.targetValue - latest.value;
  const daysRemaining = remaining / dailyRate;

  if (!Number.isFinite(daysRemaining) || daysRemaining < 0) {
    return { status: "not_progressing", daysRemaining: null, weeksRemaining: null, estimatedDate: null };
  }

  const roundedDays = Math.ceil(daysRemaining);
  const estimatedDate = new Date(latest.date);
  estimatedDate.setUTCDate(estimatedDate.getUTCDate() + roundedDays);

  return {
    status: "ok",
    daysRemaining: roundedDays,
    weeksRemaining: round1(roundedDays / 7),
    estimatedDate: formatDate(estimatedDate)
  };
}

export function compareWithForecast(goal: GoalRow, actualValue: number, forecastValue: number): ProgressStatus {
  const lowerIsBetter = goal.targetValue < goal.startValue;
  const delta = actualValue - forecastValue;

  if (Math.abs(delta) <= STATUS_TOLERANCE_KG) return "on_track";
  if (lowerIsBetter) return delta < 0 ? "ahead" : "behind";
  return delta > 0 ? "ahead" : "behind";
}

export function calculateProgressPercent(goal: GoalRow, currentValue: number): number {
  const plannedChange = goal.targetValue - goal.startValue;
  if (plannedChange === 0) return 0;
  const actualChange = currentValue - goal.startValue;
  return round1(Math.max(0, Math.min(100, (actualChange / plannedChange) * 100)));
}

export function interpolateForecast(goal: GoalRow, date: Date): number {
  const totalDays = daysBetween(goal.startDate, goal.targetDate);
  if (totalDays <= 0) return goal.targetValue;
  const elapsedDays = Math.max(0, Math.min(totalDays, daysBetween(goal.startDate, date)));
  return goal.startValue + ((goal.targetValue - goal.startValue) * elapsedDays) / totalDays;
}

export function getVisibleForecastStart(goal: GoalRow, range: "30d" | "90d" | "all", now: Date): Date {
  const rangeStart = getRangeStart(range, now);
  if (!rangeStart || rangeStart < goal.startDate) return goal.startDate;
  return rangeStart;
}

export function getRangeStart(range: "30d" | "90d" | "all", now: Date): Date | null {
  if (range === "all") return null;
  const days = range === "30d" ? 30 : 90;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return start;
}

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetween(start: Date, end: Date): number {
  return Math.round((toDateOnly(formatDate(end)).getTime() - toDateOnly(formatDate(start)).getTime()) / MS_PER_DAY);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
