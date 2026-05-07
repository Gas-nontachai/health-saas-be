import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";

const WIDGET_KEYS = [
  "summary",
  "trend",
  "timeInRange",
  "distribution",
  "dailyPattern",
  "weeklyAverage",
  "medAdherence",
  "medComparison",
  "loggingStreak",
  "recentAlerts",
  "bmi",
  "periodComparison"
] as const;

type WidgetKey = (typeof WIDGET_KEYS)[number];

const DEFAULT_WIDGETS: WidgetKey[] = ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"];
const DEFAULT_PREFERENCE_WIDGETS = normalizeDashboardWidgets(DEFAULT_WIDGETS);

const dashboardPreferenceBodySchema = z.object({
  widgets: z.array(
    z.string().refine((key): key is WidgetKey => WIDGET_KEYS.includes(key as WidgetKey), {
      message: "Unknown dashboard widget key"
    })
  )
});

const dashboardQuerySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d"),
  widgets: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return DEFAULT_WIDGETS;
      const keys = value.split(",").filter((k): k is WidgetKey => WIDGET_KEYS.includes(k as WidgetKey));
      return keys.length > 0 ? keys : DEFAULT_WIDGETS;
    })
});

const BS_LOW = 70;
const BS_HIGH = 180;

type WidgetResult = {
  status: "ok" | "insufficient_data";
  message?: string;
  data: unknown;
};

export async function registerDashboardRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/dashboard/preferences", { preHandler: app.authenticate }, async (request) => {
    const preference = await prisma.userPreference.findUnique({
      where: { userId: request.user.id },
      select: { dashboardWidgets: true }
    });

    return {
      widgets: normalizeStoredDashboardWidgets(preference?.dashboardWidgets)
    };
  });

  app.put("/dashboard/preferences", { preHandler: app.authenticate }, async (request) => {
    const body = dashboardPreferenceBodySchema.parse(request.body);
    const widgets = normalizeDashboardWidgets(body.widgets);

    await prisma.userPreference.upsert({
      where: { userId: request.user.id },
      update: { dashboardWidgets: widgets },
      create: { userId: request.user.id, dashboardWidgets: widgets }
    });

    return { widgets };
  });

  app.get("/dashboard", { preHandler: app.authenticate }, async (request) => {
    const query = dashboardQuerySchema.parse(request.query);
    const requestedWidgets = query.widgets;
    const needsPeriodComparison = requestedWidgets.includes("periodComparison") && query.range !== "all";
    const now = new Date();
    const datetimeFilter = getDatetimeFilter(query.range, 1, now);

    const where = {
      userId: request.user.id,
      ...(datetimeFilter ? { datetime: datetimeFilter } : {})
    };

    const recordSelect = {
      datetime: true,
      bloodSugar: true,
      medMorning: true,
      medEvening: true,
      note: true
    } as const;

    const [currentRecords, comparisonRecords, profile] = await Promise.all([
      prisma.record.findMany({
        where,
        orderBy: { datetime: "asc" },
        select: recordSelect
      }),
      needsPeriodComparison
        ? prisma.record.findMany({
            where: {
              userId: request.user.id,
              datetime: getDatetimeFilter(query.range, 2, now)
            },
            orderBy: { datetime: "asc" },
            select: recordSelect
          })
        : Promise.resolve([]),
      prisma.profile.findUnique({
        where: { userId: request.user.id },
        select: { weight: true, height: true }
      })
    ]);

    const widgets: Record<string, WidgetResult> = {};

    for (const key of requestedWidgets) {
      widgets[key] = buildWidget(
        key,
        key === "periodComparison" && query.range !== "all" ? comparisonRecords : currentRecords,
        profile,
        query.range,
        now
      );
    }

    return {
      range: query.range,
      availableWidgets: [...WIDGET_KEYS],
      defaultWidgets: [...DEFAULT_WIDGETS],
      widgets
    };
  });
}

function normalizeStoredDashboardWidgets(value: unknown): WidgetKey[] {
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || !WIDGET_KEYS.includes(key as WidgetKey))) {
    return DEFAULT_PREFERENCE_WIDGETS;
  }

  return normalizeDashboardWidgets(value as WidgetKey[]);
}

function normalizeDashboardWidgets(widgets: readonly WidgetKey[]): WidgetKey[] {
  const normalized: WidgetKey[] = ["summary"];

  for (const key of widgets) {
    if (key !== "summary" && !normalized.includes(key)) {
      normalized.push(key);
    }
  }

  return normalized;
}

// ——— Types ———

type RecordRow = {
  datetime: Date;
  bloodSugar: number;
  medMorning: number | null;
  medEvening: number | null;
  note: string | null;
};

type ProfileRow = { weight: number | null; height: number | null } | null;

function isMeasuredBloodSugar(record: RecordRow): boolean {
  return record.bloodSugar > 0;
}

// ——— Widget builder ———

function buildWidget(key: WidgetKey, records: RecordRow[], profile: ProfileRow, range: string, now: Date): WidgetResult {
  switch (key) {
    case "summary":
      return buildSummary(records);
    case "trend":
      return buildTrend(records);
    case "timeInRange":
      return buildTimeInRange(records);
    case "distribution":
      return buildDistribution(records);
    case "dailyPattern":
      return buildDailyPattern(records);
    case "weeklyAverage":
      return buildWeeklyAverage(records);
    case "medAdherence":
      return buildMedAdherence(records);
    case "medComparison":
      return buildMedComparison(records);
    case "loggingStreak":
      return buildLoggingStreak(records);
    case "recentAlerts":
      return buildRecentAlerts(records);
    case "bmi":
      return buildBmi(profile);
    case "periodComparison":
      return buildPeriodComparison(records, range, now);
  }
}

// ——— 1. Summary (avg / min / max) ———

function buildSummary(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in selected range", data: null };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of measuredRecords) {
    sum += r.bloodSugar;
    if (r.bloodSugar < min) min = r.bloodSugar;
    if (r.bloodSugar > max) max = r.bloodSugar;
  }

  return {
    status: "ok",
    data: {
      avg: Math.round(sum / measuredRecords.length),
      min,
      max,
      count: measuredRecords.length
    }
  };
}

// ——— 2. Trend (line chart data) ———

function buildTrend(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in selected range", data: [] };
  }

  return {
    status: "ok",
    data: measuredRecords.map((r) => ({
      datetime: r.datetime.toISOString(),
      value: r.bloodSugar
    }))
  };
}

// ——— 3. Time in Range ———

function buildTimeInRange(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in selected range", data: null };
  }

  let low = 0;
  let normal = 0;
  let high = 0;
  for (const r of measuredRecords) {
    if (r.bloodSugar < BS_LOW) low++;
    else if (r.bloodSugar > BS_HIGH) high++;
    else normal++;
  }

  const total = measuredRecords.length;
  return {
    status: "ok",
    data: {
      total,
      low: { count: low, percent: round1((low / total) * 100) },
      normal: { count: normal, percent: round1((normal / total) * 100) },
      high: { count: high, percent: round1((high / total) * 100) }
    }
  };
}

// ——— 4. Distribution (histogram buckets) ———

function buildDistribution(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in selected range", data: [] };
  }

  const buckets = [
    { label: "<70", min: 0, max: 69, count: 0 },
    { label: "70-100", min: 70, max: 100, count: 0 },
    { label: "101-140", min: 101, max: 140, count: 0 },
    { label: "141-180", min: 141, max: 180, count: 0 },
    { label: "181-250", min: 181, max: 250, count: 0 },
    { label: ">250", min: 251, max: 9999, count: 0 }
  ];

  for (const r of measuredRecords) {
    const bucket = buckets.find((b) => r.bloodSugar >= b.min && r.bloodSugar <= b.max);
    if (bucket) bucket.count++;
  }

  return {
    status: "ok",
    data: buckets.map((b) => ({ label: b.label, count: b.count }))
  };
}

// ——— 5. Daily Pattern (avg by time-of-day) ———

function buildDailyPattern(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length < 3) {
    return { status: "insufficient_data", message: "Need at least 3 records to analyze daily pattern", data: null };
  }

  const slots: Record<string, { sum: number; count: number }> = {
    morning: { sum: 0, count: 0 },
    afternoon: { sum: 0, count: 0 },
    evening: { sum: 0, count: 0 },
    night: { sum: 0, count: 0 }
  };

  for (const r of measuredRecords) {
    const hour = r.datetime.getUTCHours();
    let slot: string;
    if (hour >= 6 && hour < 12) slot = "morning";
    else if (hour >= 12 && hour < 18) slot = "afternoon";
    else if (hour >= 18 && hour < 22) slot = "evening";
    else slot = "night";
    slots[slot].sum += r.bloodSugar;
    slots[slot].count++;
  }

  return {
    status: "ok",
    data: Object.entries(slots).map(([slot, { sum, count }]) => ({
      slot,
      avg: count > 0 ? Math.round(sum / count) : null,
      count
    }))
  };
}

// ——— 6. Weekly Average ———

function buildWeeklyAverage(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length < 2) {
    return { status: "insufficient_data", message: "Need at least 2 records to compute weekly averages", data: [] };
  }

  const weekMap = new Map<string, { sum: number; count: number; min: number; max: number }>();

  for (const r of measuredRecords) {
    const weekKey = getIsoWeek(r.datetime);
    const entry = weekMap.get(weekKey) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity };
    entry.sum += r.bloodSugar;
    entry.count++;
    if (r.bloodSugar < entry.min) entry.min = r.bloodSugar;
    if (r.bloodSugar > entry.max) entry.max = r.bloodSugar;
    weekMap.set(weekKey, entry);
  }

  const weeks = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { sum, count, min, max }]) => ({
      week,
      avg: Math.round(sum / count),
      min,
      max,
      count
    }));

  return { status: "ok", data: weeks };
}

// ——— 7. Medication Adherence ———

function buildMedAdherence(records: RecordRow[]): WidgetResult {
  if (records.length === 0) {
    return { status: "insufficient_data", message: "No records in selected range", data: null };
  }

  const hasMedData = records.some((r) => r.medMorning != null || r.medEvening != null);
  if (!hasMedData) {
    return { status: "insufficient_data", message: "No medication data recorded", data: null };
  }

  const dayMap = new Map<string, { morning: boolean; evening: boolean }>();
  for (const r of records) {
    const day = r.datetime.toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { morning: false, evening: false };
    if (r.medMorning != null && r.medMorning > 0) entry.morning = true;
    if (r.medEvening != null && r.medEvening > 0) entry.evening = true;
    dayMap.set(day, entry);
  }

  const totalDays = dayMap.size;
  let morningDays = 0;
  let eveningDays = 0;
  let bothDays = 0;
  for (const { morning, evening } of dayMap.values()) {
    if (morning) morningDays++;
    if (evening) eveningDays++;
    if (morning && evening) bothDays++;
  }

  return {
    status: "ok",
    data: {
      totalDays,
      morning: { days: morningDays, percent: round1((morningDays / totalDays) * 100) },
      evening: { days: eveningDays, percent: round1((eveningDays / totalDays) * 100) },
      both: { days: bothDays, percent: round1((bothDays / totalDays) * 100) }
    }
  };
}

// ——— 8. Med vs No-Med Comparison ———

function buildMedComparison(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  const hasMedData = measuredRecords.some((r) => r.medMorning != null || r.medEvening != null);
  if (!hasMedData || measuredRecords.length < 3) {
    return { status: "insufficient_data", message: "Need at least 3 records with medication data", data: null };
  }

  const withMed: number[] = [];
  const withoutMed: number[] = [];

  for (const r of measuredRecords) {
    const tookMed = (r.medMorning != null && r.medMorning > 0) || (r.medEvening != null && r.medEvening > 0);
    if (tookMed) withMed.push(r.bloodSugar);
    else withoutMed.push(r.bloodSugar);
  }

  if (withMed.length === 0 || withoutMed.length === 0) {
    return { status: "insufficient_data", message: "Need records both with and without medication to compare", data: null };
  }

  return {
    status: "ok",
    data: {
      withMed: { avg: Math.round(avg(withMed)), count: withMed.length },
      withoutMed: { avg: Math.round(avg(withoutMed)), count: withoutMed.length },
      difference: Math.round(avg(withoutMed) - avg(withMed))
    }
  };
}

// ——— 9. Logging Streak ———

function buildLoggingStreak(records: RecordRow[]): WidgetResult {
  if (records.length === 0) {
    return { status: "insufficient_data", message: "No records in selected range", data: null };
  }

  const uniqueDays = [...new Set(records.map((r) => r.datetime.toISOString().slice(0, 10)))].sort();

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  const today = new Date().toISOString().slice(0, 10);

  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = new Date(uniqueDays[i - 1]);
    const curr = new Date(uniqueDays[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / 86_400_000;

    if (diffDays === 1) {
      tempStreak++;
    } else {
      if (tempStreak > longestStreak) longestStreak = tempStreak;
      tempStreak = 1;
    }
  }
  if (tempStreak > longestStreak) longestStreak = tempStreak;

  // Current streak: count back from today
  currentStreak = 0;
  for (let i = uniqueDays.length - 1; i >= 0; i--) {
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - (uniqueDays.length - 1 - i));
    const expectedDay = expected.toISOString().slice(0, 10);

    if (i === uniqueDays.length - 1) {
      const lastDay = uniqueDays[i];
      const diffFromToday = (new Date(today).getTime() - new Date(lastDay).getTime()) / 86_400_000;
      if (diffFromToday > 1) break;
      currentStreak = 1;
    } else if (i < uniqueDays.length - 1) {
      const prev = new Date(uniqueDays[i]);
      const next = new Date(uniqueDays[i + 1]);
      const diff = (next.getTime() - prev.getTime()) / 86_400_000;
      if (diff === 1) currentStreak++;
      else break;
    }
  }

  return {
    status: "ok",
    data: {
      currentStreak,
      longestStreak,
      totalDaysLogged: uniqueDays.length
    }
  };
}

// ——— 10. Recent Alerts ———

function buildRecentAlerts(records: RecordRow[]): WidgetResult {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in selected range", data: [] };
  }

  const alerts = measuredRecords
    .filter((r) => r.bloodSugar < BS_LOW || r.bloodSugar > BS_HIGH)
    .slice(-10)
    .reverse()
    .map((r) => ({
      datetime: r.datetime.toISOString(),
      bloodSugar: r.bloodSugar,
      level: r.bloodSugar < BS_LOW ? "low" : "high",
      note: r.note
    }));

  return { status: "ok", data: alerts };
}

// ——— 11. BMI ———

function buildBmi(profile: ProfileRow): WidgetResult {
  if (!profile?.weight || !profile?.height) {
    return { status: "insufficient_data", message: "Weight and height are required in profile to calculate BMI", data: null };
  }

  const heightM = profile.height / 100;
  const bmi = round1(profile.weight / (heightM * heightM));
  let category: string;
  if (bmi < 18.5) category = "Underweight";
  else if (bmi < 25) category = "Normal";
  else if (bmi < 30) category = "Overweight";
  else category = "Obese";

  return {
    status: "ok",
    data: { bmi, category, weight: profile.weight, height: profile.height }
  };
}

// ——— 12. Period Comparison ———

function buildPeriodComparison(records: RecordRow[], range: string, now: Date): WidgetResult {
  if (range === "all") {
    return { status: "insufficient_data", message: "Period comparison is not available for 'all' range", data: null };
  }

  const days = range === "7d" ? 7 : 30;
  const currentStart = new Date(now);
  currentStart.setUTCDate(currentStart.getUTCDate() - days);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);

  const measuredRecords = records.filter(isMeasuredBloodSugar);
  const current = measuredRecords.filter((r) => r.datetime >= currentStart);
  const previous = measuredRecords.filter((r) => r.datetime >= previousStart && r.datetime < currentStart);

  if (current.length === 0 && previous.length === 0) {
    return { status: "insufficient_data", message: "No measured blood sugar records in current or previous period", data: null };
  }

  const currentAvg = current.length > 0 ? Math.round(avg(current.map((r) => r.bloodSugar))) : null;
  const previousAvg = previous.length > 0 ? Math.round(avg(previous.map((r) => r.bloodSugar))) : null;

  return {
    status: previous.length === 0 ? "insufficient_data" : "ok",
    message: previous.length === 0 ? "No records in previous period to compare" : undefined,
    data: {
      current: { avg: currentAvg, count: current.length },
      previous: { avg: previousAvg, count: previous.length },
      change: currentAvg != null && previousAvg != null ? currentAvg - previousAvg : null
    }
  };
}

// ——— Helpers ———

function getDatetimeFilter(range: "7d" | "30d" | "all", multiplier = 1, now = new Date()): { gte: Date } | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  const start = new Date();
  start.setTime(now.getTime());
  start.setUTCDate(start.getUTCDate() - days * multiplier);
  return { gte: start };
}

function getIsoWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function avg(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
