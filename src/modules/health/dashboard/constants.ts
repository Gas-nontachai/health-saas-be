export const WIDGET_KEYS = [
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

export type WidgetKey = (typeof WIDGET_KEYS)[number];

export const DEFAULT_WIDGETS: WidgetKey[] = ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"];
export const DEFAULT_PREFERENCE_WIDGETS: WidgetKey[] = [...DEFAULT_WIDGETS];

export const BS_LOW = 70;
export const BS_HIGH = 180;
