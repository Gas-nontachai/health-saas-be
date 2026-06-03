import type { HealthDataType } from "../overview/types.js";
import {
  BLOOD_SUGAR_HEALTH_WIDGET_KEYS,
  DEFAULT_HEALTH_DASHBOARD_WIDGETS,
  DEFAULT_WEIGHT_WIDGETS,
  HEALTH_DASHBOARD_WIDGETS,
  WEIGHT_WIDGET_KEYS,
  type BloodSugarHealthWidgetKey,
  type WeightWidgetKey,
  type WidgetKey
} from "./constants.js";
import { normalizeDashboardWidgets, normalizeStoredDashboardWidgets } from "./widgets.js";

export type HealthDashboardWidgets = {
  bloodSugar: BloodSugarHealthWidgetKey[];
  weight: WeightWidgetKey[];
};

export type StoredDashboardWidgets = {
  bloodSugar: WidgetKey[];
  weight: WeightWidgetKey[];
};

export type SelectedHealthDashboardWidgets = Partial<{
  bloodSugar: BloodSugarHealthWidgetKey[];
  weight: WeightWidgetKey[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeBloodSugarHealthWidgets(value: unknown): BloodSugarHealthWidgetKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_HEALTH_DASHBOARD_WIDGETS.bloodSugar];
  const normalized: BloodSugarHealthWidgetKey[] = ["summary"];
  for (const key of strings(value)) {
    if (BLOOD_SUGAR_HEALTH_WIDGET_KEYS.includes(key as BloodSugarHealthWidgetKey) && !normalized.includes(key as BloodSugarHealthWidgetKey)) {
      normalized.push(key as BloodSugarHealthWidgetKey);
    }
  }
  return normalized;
}

function normalizeWeightWidgets(value: unknown): WeightWidgetKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_WEIGHT_WIDGETS];
  const normalized: WeightWidgetKey[] = ["summary"];
  for (const key of strings(value)) {
    if (WEIGHT_WIDGET_KEYS.includes(key as WeightWidgetKey) && !normalized.includes(key as WeightWidgetKey)) {
      normalized.push(key as WeightWidgetKey);
    }
  }
  return normalized;
}

export function normalizeHealthDashboardWidgets(value: unknown): HealthDashboardWidgets {
  if (Array.isArray(value)) {
    return {
      bloodSugar: normalizeBloodSugarHealthWidgets(value),
      weight: [...DEFAULT_WEIGHT_WIDGETS]
    };
  }

  if (!isRecord(value)) {
    return {
      bloodSugar: [...DEFAULT_HEALTH_DASHBOARD_WIDGETS.bloodSugar],
      weight: [...DEFAULT_HEALTH_DASHBOARD_WIDGETS.weight]
    };
  }

  return {
    bloodSugar: normalizeBloodSugarHealthWidgets(value.bloodSugar),
    weight: normalizeWeightWidgets(value.weight)
  };
}

export function normalizeStoredHealthDashboardWidgets(value: unknown): StoredDashboardWidgets {
  if (Array.isArray(value)) {
    return {
      bloodSugar: normalizeStoredDashboardWidgets(value),
      weight: [...DEFAULT_WEIGHT_WIDGETS]
    };
  }

  if (!isRecord(value)) {
    return {
      bloodSugar: normalizeStoredDashboardWidgets(undefined),
      weight: [...DEFAULT_WEIGHT_WIDGETS]
    };
  }

  return {
    bloodSugar: normalizeStoredDashboardWidgets(value.bloodSugar),
    weight: normalizeWeightWidgets(value.weight)
  };
}

export function normalizeLegacyDashboardWidgets(value: unknown): WidgetKey[] {
  if (isRecord(value)) return normalizeStoredDashboardWidgets(value.bloodSugar);
  return normalizeStoredDashboardWidgets(value);
}

export function withUpdatedLegacyBloodSugarWidgets(existing: unknown, widgets: WidgetKey[]): StoredDashboardWidgets {
  const normalized = normalizeStoredHealthDashboardWidgets(existing);
  return {
    ...normalized,
    bloodSugar: normalizeDashboardWidgets(widgets)
  };
}

export function buildHealthDashboardWidgetSelection(dataTypes: readonly HealthDataType[], requestedWidgets: readonly string[] | null): SelectedHealthDashboardWidgets {
  if (!requestedWidgets) {
    return Object.fromEntries(dataTypes.map((dataType) => [dataType, [...DEFAULT_HEALTH_DASHBOARD_WIDGETS[dataType]]])) as SelectedHealthDashboardWidgets;
  }

  const selected: SelectedHealthDashboardWidgets = {};
  const unsupported = requestedWidgets.filter((widget) => !dataTypes.some((dataType) => HEALTH_DASHBOARD_WIDGETS[dataType].includes(widget as never)));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported dashboard widget for selected dataTypes: ${unsupported[0]}`);
  }

  for (const dataType of dataTypes) {
    selected[dataType] = requestedWidgets.filter((widget) => HEALTH_DASHBOARD_WIDGETS[dataType].includes(widget as never)) as never;
  }

  return selected;
}
