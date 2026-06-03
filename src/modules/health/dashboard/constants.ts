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

export const BLOOD_SUGAR_HEALTH_WIDGET_KEYS = [
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
  "periodComparison"
] as const;

export type BloodSugarHealthWidgetKey = (typeof BLOOD_SUGAR_HEALTH_WIDGET_KEYS)[number];

export const DEFAULT_BLOOD_SUGAR_HEALTH_WIDGETS: BloodSugarHealthWidgetKey[] = ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"];

export const WEIGHT_WIDGET_KEYS = ["summary", "trend", "forecast", "goalProgress"] as const;

export type WeightWidgetKey = (typeof WEIGHT_WIDGET_KEYS)[number];

export const DEFAULT_WEIGHT_WIDGETS: WeightWidgetKey[] = ["summary", "trend", "forecast"];

export const HEALTH_DASHBOARD_WIDGETS = {
  bloodSugar: BLOOD_SUGAR_HEALTH_WIDGET_KEYS,
  weight: WEIGHT_WIDGET_KEYS
} as const;

export const DEFAULT_HEALTH_DASHBOARD_WIDGETS = {
  bloodSugar: DEFAULT_BLOOD_SUGAR_HEALTH_WIDGETS,
  weight: DEFAULT_WEIGHT_WIDGETS
} as const;

export const BS_LOW = 70;
export const BS_HIGH = 180;
