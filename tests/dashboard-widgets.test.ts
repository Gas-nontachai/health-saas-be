import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeHealthDashboardWidgets } from "../src/modules/health/dashboard/preferences.js";
import { buildWidget, normalizeDashboardWidgets, normalizeStoredDashboardWidgets, type RecordRow } from "../src/modules/health/dashboard/widgets.js";

describe("dashboard widgets", () => {
  it("normalizes dashboard widget preferences with summary first", () => {
    expect(normalizeDashboardWidgets(["trend", "summary", "trend"])).toEqual(["summary", "trend"]);
    expect(normalizeStoredDashboardWidgets(["unknown"])).toEqual(["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"]);
  });

  it("normalizes legacy dashboard widget arrays into per-data-type health preferences", () => {
    expect(normalizeHealthDashboardWidgets(["trend", "summary", "bmi"])).toEqual({
      bloodSugar: ["summary", "trend"],
      weight: ["summary", "trend", "forecast"]
    });
  });

  it("backfills legacy dashboard widget arrays in the migration SQL", () => {
    const migration = readFileSync("prisma/migrations/20260605000000_dashboard_widgets_per_data_type/migration.sql", "utf8");
    expect(migration).toContain("jsonb_typeof");
    expect(migration).toContain("'bloodSugar'");
    expect(migration).toContain("'weight'");
  });

  it("builds summary widget from measured blood sugar records", () => {
    const records: RecordRow[] = [
      { datetime: new Date("2026-06-01T00:00:00.000Z"), bloodSugar: 100, medMorning: null, medEvening: null, note: null },
      { datetime: new Date("2026-06-02T00:00:00.000Z"), bloodSugar: 140, medMorning: null, medEvening: null, note: null },
      { datetime: new Date("2026-06-03T00:00:00.000Z"), bloodSugar: 0, medMorning: null, medEvening: null, note: null }
    ];
    expect(buildWidget("summary", records, null, "30d", new Date("2026-06-03T00:00:00.000Z"))).toEqual({
      status: "ok",
      data: { avg: 120, min: 100, max: 140, count: 2 }
    });
  });
});
