import { describe, expect, it } from "vitest";
import { buildWidget, normalizeDashboardWidgets, normalizeStoredDashboardWidgets, type RecordRow } from "../src/modules/health/dashboard/widgets.js";

describe("dashboard widgets", () => {
  it("normalizes dashboard widget preferences with summary first", () => {
    expect(normalizeDashboardWidgets(["trend", "summary", "trend"])).toEqual(["summary", "trend"]);
    expect(normalizeStoredDashboardWidgets(["unknown"])).toEqual(["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"]);
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
