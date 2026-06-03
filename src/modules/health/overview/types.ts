export const HEALTH_DATA_TYPES = ["bloodSugar", "weight"] as const;

export type HealthDataType = (typeof HEALTH_DATA_TYPES)[number];

export type HealthRange = "7d" | "30d" | "all";

export function includesDataType(dataTypes: readonly HealthDataType[], dataType: HealthDataType): boolean {
  return dataTypes.includes(dataType);
}
