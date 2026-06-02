import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  buildRollingAverageSeries,
  calculateEta,
  calculateProgressPercent,
  calculateTrend,
  compareWithForecast,
  formatDate,
  interpolateForecast,
  round1,
  type EtaResult,
  type GoalRow,
  type MetricEntryRow,
  type ProgressStatus
} from "../health/weight/forecast.js";

export type ExportRecord = {
  datetime: Date;
  bloodSugar: number;
  medMorning: number | null;
  medEvening: number | null;
  note: string | null;
};

export type ExportContext = {
  patientName: string;
  patientEmail: string;
  weight: number | null;
  height: number | null;
  exportedAt: Date;
};

type RecordStats = {
  measuredTotal: number;
  avg: number;
  min: number;
  max: number;
  normalCount: number;
  highCount: number;
  lowCount: number;
};

export type WeightProgressContext = {
  patientName: string;
  patientEmail: string;
  exportedAt: Date;
};

export type UnifiedHealthExportInput = {
  bloodSugar?: {
    records: ExportRecord[];
    context: ExportContext;
  };
  weight?: {
    entries: MetricEntryRow[];
    goal: GoalRow | null;
    context: WeightProgressContext;
  };
  exportedAt: Date;
  patientName: string;
  patientEmail: string;
};

type WeightProgressSummary =
  | {
      status: "insufficient_data" | ProgressStatus;
      currentValue: number;
      lowestValue: number;
      highestValue: number;
      totalChange: number;
      trendKgPerWeek: number | null;
      eta: EtaResult;
      progressPercent: number | null;
      forecastValue: number | null;
      deltaVsForecast: number | null;
      latestDate: string;
    }
  | {
      status: "insufficient_data";
      message: string;
      currentValue: null;
      lowestValue: null;
      highestValue: null;
      totalChange: null;
      trendKgPerWeek: null;
      eta: EtaResult;
      progressPercent: null;
      forecastValue: null;
      deltaVsForecast: null;
      latestDate: null;
    };

// ————— Blood sugar classification (mg/dL) —————
const BS_LOW = 70;
const BS_HIGH = 180;

function isMeasuredBloodSugar(record: ExportRecord): boolean {
  return record.bloodSugar > 0;
}

function classifyBloodSugar(value: number): "Not measured" | "Low" | "Normal" | "High" {
  if (value === 0) return "Not measured";
  if (value < BS_LOW) return "Low";
  if (value > BS_HIGH) return "High";
  return "Normal";
}

function computeStats(records: ExportRecord[]): RecordStats | null {
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  if (measuredRecords.length === 0) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let lowCount = 0;
  let normalCount = 0;
  let highCount = 0;

  for (const r of measuredRecords) {
    sum += r.bloodSugar;
    if (r.bloodSugar < min) min = r.bloodSugar;
    if (r.bloodSugar > max) max = r.bloodSugar;
    const cls = classifyBloodSugar(r.bloodSugar);
    if (cls === "Low") lowCount++;
    else if (cls === "High") highCount++;
    else normalCount++;
  }

  return {
    measuredTotal: measuredRecords.length,
    avg: Math.round(sum / measuredRecords.length),
    min,
    max,
    normalCount,
    highCount,
    lowCount
  };
}

function formatDatetime(dt: Date): string {
  return dt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatDateOnly(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

const EXPORT_FONT_FAMILY = "Noto Sans Thai";
const require = createRequire(import.meta.url);
const PDF_FONT_LATIN_REGULAR_PATH = require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff");
const PDF_FONT_LATIN_BOLD_PATH = require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff");
const PDF_FONT_REGULAR_PATH = resolvePdfFontPath(
  [
    resolve(process.cwd(), "assets/fonts/Garuda.ttf"),
    "/usr/share/fonts/truetype/tlwg/Garuda.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
    "/Library/Fonts/Arial Unicode.ttf"
  ],
  require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff")
);
const PDF_FONT_BOLD_PATH = resolvePdfFontPath(
  [
    resolve(process.cwd(), "assets/fonts/Garuda-Bold.ttf"),
    "/usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf",
    "/Library/Fonts/Arial Unicode.ttf"
  ],
  require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff")
);
const PDF_FONT_EMOJI_PATH = require.resolve("@fontsource/noto-emoji/files/noto-emoji-emoji-400-normal.woff");
const PDF_FONT_MATH_PATH = require.resolve("@fontsource/noto-sans-math/files/noto-sans-math-math-400-normal.woff");
const PDF_FONT_SYMBOLS_PATH = require.resolve("@fontsource/noto-sans-symbols/files/noto-sans-symbols-symbols-400-normal.woff");
const PDF_FONT_SYMBOLS_2_PATH = require.resolve("@fontsource/noto-sans-symbols-2/files/noto-sans-symbols-2-symbols-400-normal.woff");
const THAI_TEXT_RE = /[\u0E00-\u0E7F]/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const MATH_TEXT_RE = /[≤≥∞≈±∓÷×≠→←↑↓↔↕∑√∫∂∆∇∈∉∩∪⊂⊃⊆⊇]/u;
const SYMBOLS_2_TEXT_RE = /[✓✔✕✖✗✘]/u;
const SYMBOLS_TEXT_RE = /[⚕⚠♠♣♥♦♪♫★☆☀☁☂☕☑☒]/u;

function resolvePdfFontPath(candidates: string[], fallback: string): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

// ══════════════════════════════════════════════
//  EXCEL BUILDER
// ══════════════════════════════════════════════

export async function buildExcel(records: ExportRecord[], ctx: ExportContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Health SaaS";
  workbook.created = ctx.exportedAt;

  const stats = computeStats(records);

  // ——— Summary Sheet ———
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 32 }];

  const titleRow = summary.addRow(["Blood Sugar Report"]);
  titleRow.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 16 };
  summary.mergeCells("A1:B1");
  summary.addRow([]);

  summary.addRow(["Patient Name", ctx.patientName]);
  summary.addRow(["Email", ctx.patientEmail]);
  if (ctx.weight) summary.addRow(["Weight (kg)", ctx.weight]);
  if (ctx.height) summary.addRow(["Height (cm)", ctx.height]);
  summary.addRow(["Export Date", formatDatetime(ctx.exportedAt)]);
  summary.addRow([]);

  if (stats) {
    const dateRange =
      records.length > 0 ? `${formatDateOnly(records[0].datetime)} — ${formatDateOnly(records[records.length - 1].datetime)}` : "-";
    const statsHeader = summary.addRow(["Statistics"]);
    statsHeader.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
    summary.addRow(["Date Range", dateRange]);
    summary.addRow(["Total Records", records.length]);
    summary.addRow(["Measured Records", stats.measuredTotal]);
    summary.addRow(["Average (mg/dL)", stats.avg]);
    summary.addRow(["Min (mg/dL)", stats.min]);
    summary.addRow(["Max (mg/dL)", stats.max]);
    summary.addRow([]);
    summary.addRow(["Normal (70–180 mg/dL)", `${stats.normalCount} (${pct(stats.normalCount, stats.measuredTotal)})`]);
    summary.addRow(["Low (< 70 mg/dL)", `${stats.lowCount} (${pct(stats.lowCount, stats.measuredTotal)})`]);
    summary.addRow(["High (> 180 mg/dL)", `${stats.highCount} (${pct(stats.highCount, stats.measuredTotal)})`]);
  } else {
    summary.addRow([records.length > 0 ? "No measured blood sugar records found." : "No records found."]);
  }

  styleLabelColumn(summary);

  // ——— Records Sheet ———
  const sheet = workbook.addWorksheet("Records");

  sheet.columns = [
    { header: "#", key: "no", width: 6 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time (UTC)", key: "time", width: 12 },
    { header: "Blood Sugar\n(mg/dL)", key: "bloodSugar", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Morning Med", key: "medMorning", width: 14 },
    { header: "Evening Med", key: "medEvening", width: 14 },
    { header: "Note", key: "note", width: 52 }
  ];

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.font = { name: EXPORT_FONT_FAMILY, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5090" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 30;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const iso = r.datetime.toISOString();
    const status = classifyBloodSugar(r.bloodSugar);
    const row = sheet.addRow({
      no: i + 1,
      date: iso.slice(0, 10),
      time: iso.slice(11, 19),
      bloodSugar: r.bloodSugar,
      status,
      medMorning: r.medMorning ?? "-",
      medEvening: r.medEvening ?? "-",
      note: r.note ?? ""
    });

    row.font = { name: EXPORT_FONT_FAMILY };
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell("bloodSugar").alignment = { horizontal: "center" };
    row.getCell("status").alignment = { horizontal: "center" };
    row.getCell("no").alignment = { horizontal: "center" };
    row.getCell("note").alignment = { vertical: "top", wrapText: true };

    // Alternate row shading
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      });
    }

    // Color-code blood sugar status
    const statusCell = row.getCell("status");
    if (status === "Low") {
      statusCell.font = { name: EXPORT_FONT_FAMILY, bold: true, color: { argb: "FFCC6600" } };
    } else if (status === "High") {
      statusCell.font = { name: EXPORT_FONT_FAMILY, bold: true, color: { argb: "FFCC0000" } };
    } else if (status === "Not measured") {
      statusCell.font = { name: EXPORT_FONT_FAMILY, color: { argb: "FF666666" } };
    } else {
      statusCell.font = { name: EXPORT_FONT_FAMILY, color: { argb: "FF007A33" } };
    }
  }

  // Borders
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } }
      };
    });
  });

  // Auto-filter
  sheet.autoFilter = { from: "A1", to: `H${records.length + 1}` };

  // Freeze header row
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function styleLabelColumn(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row) => {
    row.font = { name: EXPORT_FONT_FAMILY, ...row.font };
    row.alignment = { vertical: "middle", wrapText: true };
    const cell = row.getCell(1);
    if (typeof cell.value === "string" && cell.value && !row.font?.size) {
      cell.font = { name: EXPORT_FONT_FAMILY, ...cell.font, bold: true };
    }
  });
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

// ══════════════════════════════════════════════
//  WEIGHT PROGRESS EXPORT BUILDERS
// ══════════════════════════════════════════════

export async function buildWeightProgressExcel(
  entries: MetricEntryRow[],
  goal: GoalRow | null,
  ctx: WeightProgressContext
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Health SaaS";
  workbook.created = ctx.exportedAt;

  const summary = buildWeightProgressSummary(entries, goal);
  const rollingAverage = buildRollingAverageSeries(entries);

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [{ width: 28 }, { width: 34 }];
  const titleRow = summarySheet.addRow(["Weight Progress Report"]);
  titleRow.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 16 };
  summarySheet.mergeCells("A1:B1");
  summarySheet.addRow([]);

  summarySheet.addRow(["Patient Name", ctx.patientName]);
  summarySheet.addRow(["Email", ctx.patientEmail]);
  summarySheet.addRow(["Export Date", formatDatetime(ctx.exportedAt)]);
  summarySheet.addRow(["Report Period", formatWeightReportPeriod(entries)]);
  summarySheet.addRow([]);

  const goalHeader = summarySheet.addRow(["Goal"]);
  goalHeader.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
  if (goal) {
    summarySheet.addRow(["Start", `${formatDate(goal.startDate)} / ${round1(goal.startValue)} kg`]);
    summarySheet.addRow(["Target", `${formatDate(goal.targetDate)} / ${round1(goal.targetValue)} kg`]);
    summarySheet.addRow(["Target Change", `${round1(goal.targetValue - goal.startValue)} kg`]);
  } else {
    summarySheet.addRow(["Goal Status", "insufficient_data"]);
  }
  summarySheet.addRow([]);

  const progressHeader = summarySheet.addRow(["Progress"]);
  progressHeader.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
  summarySheet.addRow(["Forecast Status", summary.status]);
  if ("message" in summary) {
    summarySheet.addRow(["Message", summary.message]);
  }
  summarySheet.addRow(["Current Weight (kg)", formatNullableNumber(summary.currentValue)]);
  summarySheet.addRow(["Lowest Weight (kg)", formatNullableNumber(summary.lowestValue)]);
  summarySheet.addRow(["Highest Weight (kg)", formatNullableNumber(summary.highestValue)]);
  summarySheet.addRow(["Total Change (kg)", formatNullableNumber(summary.totalChange)]);
  summarySheet.addRow(["Trend (kg/week)", formatNullableNumber(summary.trendKgPerWeek)]);
  summarySheet.addRow(["Progress (%)", formatNullableNumber(summary.progressPercent)]);
  summarySheet.addRow(["ETA", formatEta(summary.eta)]);
  summarySheet.addRow(["Forecast Value (kg)", formatNullableNumber(summary.forecastValue)]);
  summarySheet.addRow(["Delta vs Forecast (kg)", formatNullableNumber(summary.deltaVsForecast)]);

  styleLabelColumn(summarySheet);

  const logSheet = workbook.addWorksheet("Weight Log");
  logSheet.columns = [
    { header: "#", key: "no", width: 6 },
    { header: "Date", key: "date", width: 14 },
    { header: "Weight (kg)", key: "weight", width: 14 },
    { header: "7-Day Average", key: "rollingAverage", width: 16 },
    { header: "Forecast (kg)", key: "forecast", width: 16 },
    { header: "Delta vs Forecast", key: "delta", width: 18 }
  ];

  styleWeightLogHeader(logSheet);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const forecastValue = goal ? round1(interpolateForecast(goal, entry.date)) : null;
    const row = logSheet.addRow({
      no: i + 1,
      date: formatDate(entry.date),
      weight: round1(entry.value),
      rollingAverage: rollingAverage[i].value,
      forecast: forecastValue ?? "-",
      delta: forecastValue !== null ? round1(entry.value - forecastValue) : "-"
    });

    row.font = { name: EXPORT_FONT_FAMILY };
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell("no").alignment = { horizontal: "center" };
    for (const key of ["weight", "rollingAverage", "forecast", "delta"]) {
      row.getCell(key).alignment = { horizontal: "center" };
    }

    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      });
    }
  }

  logSheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } }
      };
    });
  });
  logSheet.autoFilter = { from: "A1", to: `F${entries.length + 1}` };
  logSheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildWeightProgressPdf(entries: MetricEntryRow[], goal: GoalRow | null, ctx: WeightProgressContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerPdfFonts(doc);

    const summary = buildWeightProgressSummary(entries, goal);
    const rollingAverage = buildRollingAverageSeries(entries);

    doc
      .fontSize(6.5)
      .font("Latin")
      .fillColor("#999999")
      .text(`Exported: ${formatDatetime(ctx.exportedAt)}`, doc.page.width - 210, 24, {
        width: 170,
        align: "right",
        lineBreak: false
      });

    doc.y = 64;
    doc.fontSize(18).font("Latin-Bold").fillColor("#111111").text("Weight Progress Report", 40, doc.y, {
      width: doc.page.width - 80,
      align: "center"
    });
    doc.moveDown(0.35);
    doc.fontSize(9).fillColor("#555555");
    drawCenteredFallbackLine(doc, `Patient: ${ctx.patientName}  |  Email: ${ctx.patientEmail}`);
    doc.y += 3;
    drawCenteredFallbackLine(doc, `Period: ${formatWeightReportPeriod(entries)}`);
    doc.moveDown(0.8);

    drawWeightSummaryBlock(doc, entries, goal, summary);

    if (entries.length === 0) {
      doc.moveDown(0.8);
      doc.fontSize(11).font("Latin").fillColor("#000000").text("No weight entries found.");
      drawWeightPageFooters(doc, ctx);
      doc.end();
      return;
    }

    doc.moveDown(0.8);
    drawWeightTableHeader(doc);

    for (let i = 0; i < entries.length; i++) {
      if (doc.y + WEIGHT_PDF_ROW_HEIGHT > doc.page.height - PDF_BOTTOM) {
        doc.addPage();
        drawWeightTableHeader(doc);
      }

      const entry = entries[i];
      const forecastValue = goal ? round1(interpolateForecast(goal, entry.date)) : null;
      const cells = [
        String(i + 1),
        formatDate(entry.date),
        String(round1(entry.value)),
        String(rollingAverage[i].value),
        forecastValue !== null ? String(forecastValue) : "-",
        forecastValue !== null ? String(round1(entry.value - forecastValue)) : "-"
      ];

      const rowTop = doc.y;
      if (i % 2 === 1) {
        doc.save().rect(WEIGHT_TABLE_LEFT, rowTop, WEIGHT_PDF_TABLE_WIDTH, WEIGHT_PDF_ROW_HEIGHT).fill("#F2F6FA").restore();
      }

      let x = WEIGHT_TABLE_LEFT;
      doc.fontSize(7.5).font("Latin").fillColor("#000000");
      for (let c = 0; c < cells.length; c++) {
        doc.text(cells[c], x + 3, rowTop + 6, { width: WEIGHT_PDF_COL_WIDTHS[c] - 6, ellipsis: true, lineBreak: false });
        x += WEIGHT_PDF_COL_WIDTHS[c];
      }

      const rowBottom = rowTop + WEIGHT_PDF_ROW_HEIGHT;
      doc
        .save()
        .moveTo(WEIGHT_TABLE_LEFT, rowBottom)
        .lineTo(WEIGHT_TABLE_LEFT + WEIGHT_PDF_TABLE_WIDTH, rowBottom)
        .lineWidth(0.3)
        .strokeColor("#D0D0D0")
        .stroke()
        .restore();
      doc.y = rowBottom;
    }

    drawWeightPageFooters(doc, ctx);
    doc.end();
  });
}

export async function buildUnifiedHealthExcel(input: UnifiedHealthExportInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Health SaaS";
  workbook.created = input.exportedAt;

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 42 }];
  const titleRow = summary.addRow(["Health Report"]);
  titleRow.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 16 };
  summary.mergeCells("A1:B1");
  summary.addRow([]);
  summary.addRow(["Patient Name", input.patientName]);
  summary.addRow(["Email", input.patientEmail]);
  summary.addRow(["Export Date", formatDatetime(input.exportedAt)]);
  summary.addRow(["Included Data", [input.bloodSugar ? "Blood Sugar" : null, input.weight ? "Weight" : null].filter(Boolean).join(", ")]);
  summary.addRow([]);

  if (input.bloodSugar) {
    const stats = computeStats(input.bloodSugar.records);
    const header = summary.addRow(["Blood Sugar"]);
    header.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
    summary.addRow(["Blood Sugar Records", input.bloodSugar.records.length]);
    if (stats) {
      summary.addRow(["Average (mg/dL)", stats.avg]);
      summary.addRow(["Min / Max (mg/dL)", `${stats.min} / ${stats.max}`]);
    }
    summary.addRow([]);
  }

  if (input.weight) {
    const weightSummary = buildWeightProgressSummary(input.weight.entries, input.weight.goal);
    const header = summary.addRow(["Weight"]);
    header.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
    summary.addRow(["Weight Entries", input.weight.entries.length]);
    summary.addRow(["Forecast Status", weightSummary.status]);
    summary.addRow(["Current Weight (kg)", formatNullableNumber(weightSummary.currentValue)]);
    summary.addRow(["Trend (kg/week)", formatNullableNumber(weightSummary.trendKgPerWeek)]);
  }
  styleLabelColumn(summary);

  if (input.bloodSugar) {
    addBloodSugarSheet(workbook, input.bloodSugar.records);
  }
  if (input.weight) {
    addWeightLogSheet(workbook, input.weight.entries, input.weight.goal);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildUnifiedHealthPdf(input: UnifiedHealthExportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerPdfFonts(doc);
    doc
      .fontSize(6.5)
      .font("Latin")
      .fillColor("#999999")
      .text(`Exported: ${formatDatetime(input.exportedAt)}`, doc.page.width - 210, 24, {
        width: 170,
        align: "right",
        lineBreak: false
      });

    doc.y = 64;
    doc.fontSize(18).font("Latin-Bold").fillColor("#111111").text("Health Report", 40, doc.y, {
      width: doc.page.width - 80,
      align: "center"
    });
    doc.moveDown(0.35);
    doc.fontSize(9).fillColor("#555555");
    drawCenteredFallbackLine(doc, `Patient: ${input.patientName}  |  Email: ${input.patientEmail}`);
    doc.moveDown(1);

    if (input.bloodSugar) {
      const stats = computeStats(input.bloodSugar.records);
      doc.fontSize(11).font("Latin-Bold").fillColor("#111111").text("Blood Sugar", TABLE_LEFT);
      doc.fontSize(8).font("Latin").fillColor("#333333").text(`Records: ${input.bloodSugar.records.length}`, TABLE_LEFT);
      if (stats) {
        doc.text(`Avg: ${stats.avg} mg/dL  |  Min: ${stats.min}  |  Max: ${stats.max}`, TABLE_LEFT);
      }
      doc.moveDown(0.8);
    }

    if (input.weight) {
      const weightSummary = buildWeightProgressSummary(input.weight.entries, input.weight.goal);
      doc.fontSize(11).font("Latin-Bold").fillColor("#111111").text("Weight", TABLE_LEFT);
      doc
        .fontSize(8)
        .font("Latin")
        .fillColor("#333333")
        .text(
          `Entries: ${input.weight.entries.length}  |  Status: ${weightSummary.status}  |  Current: ${formatNullableNumber(
            weightSummary.currentValue
          )} kg  |  Trend: ${formatNullableNumber(weightSummary.trendKgPerWeek)} kg/week`,
          TABLE_LEFT
        );
    }

    drawUnifiedPageFooters(doc, input);
    doc.end();
  });
}

function addBloodSugarSheet(workbook: ExcelJS.Workbook, records: ExportRecord[]): void {
  const sheet = workbook.addWorksheet("Blood Sugar");
  sheet.columns = [
    { header: "#", key: "no", width: 6 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time (UTC)", key: "time", width: 12 },
    { header: "Blood Sugar (mg/dL)", key: "bloodSugar", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Morning Med", key: "medMorning", width: 14 },
    { header: "Evening Med", key: "medEvening", width: 14 },
    { header: "Note", key: "note", width: 52 }
  ];
  styleWeightLogHeader(sheet);
  records.forEach((record, index) => {
    const iso = record.datetime.toISOString();
    sheet.addRow({
      no: index + 1,
      date: iso.slice(0, 10),
      time: iso.slice(11, 19),
      bloodSugar: record.bloodSugar,
      status: classifyBloodSugar(record.bloodSugar),
      medMorning: record.medMorning ?? "-",
      medEvening: record.medEvening ?? "-",
      note: record.note ?? ""
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function addWeightLogSheet(workbook: ExcelJS.Workbook, entries: MetricEntryRow[], goal: GoalRow | null): void {
  const sheet = workbook.addWorksheet("Weight Progress");
  sheet.columns = [
    { header: "#", key: "no", width: 6 },
    { header: "Date", key: "date", width: 14 },
    { header: "Weight (kg)", key: "weight", width: 14 },
    { header: "7-Day Average", key: "rollingAverage", width: 16 },
    { header: "Forecast (kg)", key: "forecast", width: 16 },
    { header: "Delta vs Forecast", key: "delta", width: 18 }
  ];
  styleWeightLogHeader(sheet);
  const rollingAverage = buildRollingAverageSeries(entries);
  entries.forEach((entry, index) => {
    const forecastValue = goal ? round1(interpolateForecast(goal, entry.date)) : null;
    sheet.addRow({
      no: index + 1,
      date: formatDate(entry.date),
      weight: round1(entry.value),
      rollingAverage: rollingAverage[index].value,
      forecast: forecastValue ?? "-",
      delta: forecastValue !== null ? round1(entry.value - forecastValue) : "-"
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function drawUnifiedPageFooters(doc: PDFKit.PDFDocument, input: UnifiedHealthExportInput): void {
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#999999");
    drawCenteredFallbackLine(doc, `Page ${i + 1} of ${pageCount}  -  Health Report  -  ${input.patientName}`, doc.page.height - 55);
  }
}

function buildWeightProgressSummary(entries: MetricEntryRow[], goal: GoalRow | null): WeightProgressSummary {
  const etaUnavailable: EtaResult = { status: "not_progressing", daysRemaining: null, weeksRemaining: null, estimatedDate: null };

  if (entries.length === 0) {
    return {
      status: "insufficient_data",
      message: "No weight entries found.",
      currentValue: null,
      lowestValue: null,
      highestValue: null,
      totalChange: null,
      trendKgPerWeek: null,
      eta: etaUnavailable,
      progressPercent: null,
      forecastValue: null,
      deltaVsForecast: null,
      latestDate: null
    };
  }

  const latest = entries[entries.length - 1];
  const trend = calculateTrend(entries);
  const forecastValue = goal ? interpolateForecast(goal, latest.date) : null;
  const eta = goal ? calculateEta(goal, latest, trend.kgPerWeek) : etaUnavailable;

  return {
    status: goal && forecastValue !== null ? compareWithForecast(goal, latest.value, forecastValue) : "insufficient_data",
    currentValue: round1(latest.value),
    lowestValue: round1(Math.min(...entries.map((entry) => entry.value))),
    highestValue: round1(Math.max(...entries.map((entry) => entry.value))),
    totalChange: round1(latest.value - entries[0].value),
    trendKgPerWeek: trend.status === "ok" ? round1(trend.kgPerWeek) : null,
    eta,
    progressPercent: goal ? calculateProgressPercent(goal, latest.value) : null,
    forecastValue: forecastValue !== null ? round1(forecastValue) : null,
    deltaVsForecast: forecastValue !== null ? round1(latest.value - forecastValue) : null,
    latestDate: formatDate(latest.date)
  };
}

function styleWeightLogHeader(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = { name: EXPORT_FONT_FAMILY, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5090" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 28;
}

function formatWeightReportPeriod(entries: MetricEntryRow[]): string {
  if (entries.length === 0) return "-";
  return `${formatDate(entries[0].date)} - ${formatDate(entries[entries.length - 1].date)}`;
}

function formatNullableNumber(value: number | null): number | string {
  return value === null ? "-" : value;
}

function formatEta(eta: EtaResult): string {
  if (eta.status !== "ok") return "not_progressing";
  return `${eta.estimatedDate} (${eta.daysRemaining} days / ${eta.weeksRemaining} weeks)`;
}

function registerPdfFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont("Latin", PDF_FONT_LATIN_REGULAR_PATH);
  doc.registerFont("Latin-Bold", PDF_FONT_LATIN_BOLD_PATH);
  doc.registerFont("Thai", PDF_FONT_REGULAR_PATH);
  doc.registerFont("Thai-Bold", PDF_FONT_BOLD_PATH);
  doc.registerFont("Emoji", PDF_FONT_EMOJI_PATH);
  doc.registerFont("Math", PDF_FONT_MATH_PATH);
  doc.registerFont("Symbols", PDF_FONT_SYMBOLS_PATH);
  doc.registerFont("Symbols2", PDF_FONT_SYMBOLS_2_PATH);
}

const WEIGHT_PDF_COL_WIDTHS = [28, 76, 82, 93, 89, 108];
const WEIGHT_TABLE_LEFT = 60;
const WEIGHT_PDF_TABLE_WIDTH = WEIGHT_PDF_COL_WIDTHS.reduce((a, b) => a + b, 0);
const WEIGHT_PDF_HEADER_HEIGHT = 22;
const WEIGHT_PDF_ROW_HEIGHT = 22;

function drawWeightSummaryBlock(doc: PDFKit.PDFDocument, entries: MetricEntryRow[], goal: GoalRow | null, summary: WeightProgressSummary): void {
  doc.fillColor("#000000").fontSize(10).font("Latin-Bold").text("Summary", WEIGHT_TABLE_LEFT);
  doc.moveDown(0.2);
  doc.fontSize(8).font("Latin").fillColor("#333333");

  if (goal) {
    doc.text(
      `Goal: ${formatDate(goal.startDate)} / ${round1(goal.startValue)} kg  ->  ${formatDate(goal.targetDate)} / ${round1(goal.targetValue)} kg`,
      WEIGHT_TABLE_LEFT
    );
  } else {
    doc.text("Goal: insufficient_data", WEIGHT_TABLE_LEFT);
  }

  if (entries.length === 0) {
    doc.text("Progress: No weight entries found.", WEIGHT_TABLE_LEFT);
    return;
  }

  doc.text(
    `Status: ${summary.status}  |  Current: ${summary.currentValue} kg  |  Change: ${summary.totalChange} kg  |  Trend: ${formatNullableNumber(
      summary.trendKgPerWeek
    )} kg/week`,
    WEIGHT_TABLE_LEFT
  );
  doc.text(
    `ETA: ${formatEta(summary.eta)}  |  Progress: ${formatNullableNumber(summary.progressPercent)}%  |  Forecast: ${formatNullableNumber(
      summary.forecastValue
    )} kg  |  Delta: ${formatNullableNumber(summary.deltaVsForecast)} kg`,
    WEIGHT_TABLE_LEFT
  );
}

function drawWeightTableHeader(doc: PDFKit.PDFDocument): void {
  const headers = ["#", "Date", "Weight", "7-Day Avg", "Forecast", "Delta vs Forecast"];
  doc.save().rect(WEIGHT_TABLE_LEFT, doc.y, WEIGHT_PDF_TABLE_WIDTH, WEIGHT_PDF_HEADER_HEIGHT).fill(HEADER_BG).restore();

  const headerY = doc.y + 5;
  let x = WEIGHT_TABLE_LEFT;
  doc.fontSize(7.5).font("Latin-Bold").fillColor("#FFFFFF");
  for (let c = 0; c < headers.length; c++) {
    doc.text(headers[c], x + 3, headerY, { width: WEIGHT_PDF_COL_WIDTHS[c] - 6, lineBreak: false });
    x += WEIGHT_PDF_COL_WIDTHS[c];
  }

  doc.y = headerY - 5 + WEIGHT_PDF_HEADER_HEIGHT;
  doc.fillColor("#000000");
}

function drawWeightPageFooters(doc: PDFKit.PDFDocument, ctx: WeightProgressContext): void {
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#999999");
    drawCenteredFallbackLine(doc, `Page ${i + 1} of ${pageCount}  -  Weight Progress Report  -  ${ctx.patientName}`, doc.page.height - 55);
  }
}

// ══════════════════════════════════════════════
//  PDF BUILDER
// ══════════════════════════════════════════════

const PDF_COL_WIDTHS = [28, 76, 58, 86, 76, 93, 98];
const TABLE_LEFT = 40;
const PDF_TABLE_WIDTH = PDF_COL_WIDTHS.reduce((a, b) => a + b, 0);
const PDF_HEADER_HEIGHT = 22;
const PDF_MAIN_ROW_HEIGHT = 22;
const PDF_NOTE_PADDING = 8;
const PDF_ROW_GAP = 4;
const PDF_BOTTOM = 70;
const HEADER_BG = "#2E5090";

export function buildPdf(records: ExportRecord[], ctx: ExportContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Latin", PDF_FONT_LATIN_REGULAR_PATH);
    doc.registerFont("Latin-Bold", PDF_FONT_LATIN_BOLD_PATH);
    doc.registerFont("Thai", PDF_FONT_REGULAR_PATH);
    doc.registerFont("Thai-Bold", PDF_FONT_BOLD_PATH);
    doc.registerFont("Emoji", PDF_FONT_EMOJI_PATH);
    doc.registerFont("Math", PDF_FONT_MATH_PATH);
    doc.registerFont("Symbols", PDF_FONT_SYMBOLS_PATH);
    doc.registerFont("Symbols2", PDF_FONT_SYMBOLS_2_PATH);

    const stats = computeStats(records);

    // ——— Header ———
    doc
      .fontSize(6.5)
      .font("Latin")
      .fillColor("#999999")
      .text(`Exported: ${formatDatetime(ctx.exportedAt)}`, doc.page.width - 210, 24, {
        width: 170,
        align: "right",
        lineBreak: false
      });

    doc.y = 64;
    doc.fontSize(18).font("Latin-Bold").fillColor("#111111").text("Blood Sugar Report", 40, doc.y, {
      width: doc.page.width - 80,
      align: "center"
    });
    doc.moveDown(0.35);
    doc.fontSize(9).fillColor("#555555");
    drawCenteredFallbackLine(doc, `Patient: ${ctx.patientName}  |  Email: ${ctx.patientEmail}`);
    doc.y += 3;
    const profileParts = [
      ctx.weight ? `Weight: ${ctx.weight} kg` : null,
      ctx.height ? `Height: ${ctx.height} cm` : null
    ].filter(Boolean);
    if (profileParts.length > 0) {
      drawCenteredFallbackLine(doc, profileParts.join("  |  "));
      doc.y += 3;
    }
    doc.moveDown(0.7);

    // ——— Summary Stats ———
    if (stats) {
      const dateRange =
        records.length > 0 ? `${formatDateOnly(records[0].datetime)} — ${formatDateOnly(records[records.length - 1].datetime)}` : "-";

      doc.fillColor("#000000").fontSize(10).font("Latin-Bold").text("Summary", TABLE_LEFT);
      doc.moveDown(0.2);
      doc.fontSize(8).font("Latin").fillColor("#333333");
      doc.text(
        `Period: ${dateRange}  |  Records: ${records.length}  |  Measured: ${stats.measuredTotal}  |  Avg: ${stats.avg} mg/dL  |  Min: ${stats.min} mg/dL  |  Max: ${stats.max} mg/dL`,
        TABLE_LEFT
      );
      doc.text(
        `Normal (70–180): ${stats.normalCount} (${pct(stats.normalCount, stats.measuredTotal)})  |  ` +
          `Low (<70): ${stats.lowCount} (${pct(stats.lowCount, stats.measuredTotal)})  |  ` +
          `High (>180): ${stats.highCount} (${pct(stats.highCount, stats.measuredTotal)})`,
        TABLE_LEFT
      );
      doc.moveDown(0.5);
    }

    if (records.length === 0) {
      doc.fontSize(11).font("Latin").fillColor("#000000").text("No records found.");
      drawPageFooters(doc, ctx);
      doc.end();
      return;
    }

    // ——— Table ———
    const headers = ["#", "Date", "Time", "Blood Sugar", "Status", "Morning Med", "Evening Med"];

    drawTableHeader(doc, headers);

    for (let i = 0; i < records.length; i++) {
      const rowHeight = measurePdfRecordHeight(doc, records[i]);

      if (doc.y + rowHeight > doc.page.height - PDF_BOTTOM) {
        doc.addPage();
        drawTableHeader(doc, headers);
      }

      const r = records[i];
      const iso = r.datetime.toISOString();
      const status = classifyBloodSugar(r.bloodSugar);

      // Alternate row background
      const rowTop = doc.y;
      if (i % 2 === 1) {
        doc.save().rect(TABLE_LEFT, rowTop, PDF_TABLE_WIDTH, rowHeight).fill("#F2F6FA").restore();
      }

      const rowY = rowTop + 6;
      const cells = [
        String(i + 1),
        iso.slice(0, 10),
        iso.slice(11, 19),
        String(r.bloodSugar),
        status,
        r.medMorning != null ? String(r.medMorning) : "-",
        r.medEvening != null ? String(r.medEvening) : "-"
      ];

      let x = TABLE_LEFT;
      doc.fontSize(7.5).font("Latin").fillColor("#000000");
      for (let c = 0; c < cells.length; c++) {
        // Color status column
        if (c === 4) {
          if (cells[c] === "Low") doc.fillColor("#CC6600");
          else if (cells[c] === "High") doc.fillColor("#CC0000");
          else if (cells[c] === "Not measured") doc.fillColor("#666666");
          else doc.fillColor("#007A33");
          doc.font("Latin-Bold");
        }

        doc.text(cells[c], x + 3, rowY, { width: PDF_COL_WIDTHS[c] - 6, ellipsis: true, lineBreak: false });

        if (c === 4) {
          doc.fillColor("#000000").font("Latin");
        }
        x += PDF_COL_WIDTHS[c];
      }

      const note = r.note?.trim();
      if (note) {
        const noteTop = rowTop + PDF_MAIN_ROW_HEIGHT;
        doc.fontSize(7.5).font("Latin-Bold").fillColor("#555555").text("Note:", TABLE_LEFT + 3, noteTop + 3, {
          width: 34,
          lineBreak: false
        });
        doc.fontSize(7.5).fillColor("#000000");
        drawMixedParagraph(doc, note, TABLE_LEFT + 40, noteTop + 3, PDF_TABLE_WIDTH - 46);
      }

      const rowBottom = rowTop + rowHeight;
      doc
        .save()
        .moveTo(TABLE_LEFT, rowBottom)
        .lineTo(TABLE_LEFT + PDF_TABLE_WIDTH, rowBottom)
        .lineWidth(0.3)
        .strokeColor("#D0D0D0")
        .stroke()
        .restore();

      doc.y = rowBottom;
    }

    drawPageFooters(doc, ctx);

    doc.end();
  });
}

function drawTableHeader(doc: PDFKit.PDFDocument, headers: string[]): void {
  // Header background
  doc.save().rect(TABLE_LEFT, doc.y, PDF_TABLE_WIDTH, PDF_HEADER_HEIGHT).fill(HEADER_BG).restore();

  const headerY = doc.y + 5;
  let x = TABLE_LEFT;
  doc.fontSize(7.5).font("Latin-Bold").fillColor("#FFFFFF");
  for (let c = 0; c < headers.length; c++) {
    doc.text(headers[c], x + 3, headerY, { width: PDF_COL_WIDTHS[c] - 6, lineBreak: false });
    x += PDF_COL_WIDTHS[c];
  }

  doc.y = headerY - 5 + PDF_HEADER_HEIGHT;
  doc.fillColor("#000000");
}

function measurePdfRecordHeight(doc: PDFKit.PDFDocument, record: ExportRecord): number {
  const note = record.note?.trim();
  if (!note) return PDF_MAIN_ROW_HEIGHT;

  const noteHeight = measureMixedParagraphHeight(doc, note, PDF_TABLE_WIDTH - 46, 7.5);
  return Math.max(PDF_MAIN_ROW_HEIGHT + noteHeight + PDF_NOTE_PADDING, PDF_MAIN_ROW_HEIGHT + 14) + PDF_ROW_GAP;
}

function drawPageFooters(doc: PDFKit.PDFDocument, ctx: ExportContext): void {
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#999999");
    drawCenteredFallbackLine(doc, `Page ${i + 1} of ${pageCount}  -  Blood Sugar Report  -  ${ctx.patientName}`, doc.page.height - 55);
  }
}

function drawCenteredFallbackLine(doc: PDFKit.PDFDocument, text: string, y = doc.y): void {
  const safeText = normalizePdfText(text);
  const runs = splitFontRuns(safeText, false);
  const width = measureRunsWidth(doc, runs);
  let x = Math.max(TABLE_LEFT, (doc.page.width - width) / 2);
  for (const run of runs) {
    doc.font(run.font).text(run.text, x, y, { lineBreak: false });
    x += doc.widthOfString(run.text);
  }
  doc.y = y + doc.currentLineHeight(true);
}

function drawFallbackText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions = {},
  bold = false
): void {
  const runs = splitFontRuns(normalizePdfText(text), bold);
  for (let i = 0; i < runs.length; i++) {
    doc.font(runs[i].font);
    doc.text(runs[i].text, i === 0 ? x : undefined, i === 0 ? y : undefined, {
      ...options,
      continued: i < runs.length - 1
    });
  }
}

function splitFontRuns(text: string, bold: boolean): Array<{ text: string; font: string }> {
  const runs: Array<{ text: string; font: string }> = [];
  let current = "";
  let currentFont: string | null = null;

  for (const segment of graphemeSegments(text)) {
    const font = fontForPdfSegment(segment, bold);
    if (currentFont !== null && font !== currentFont) {
      runs.push({ text: current, font: currentFont });
      current = "";
    }
    current += segment;
    currentFont = font;
  }

  if (current && currentFont !== null) {
    runs.push({ text: current, font: currentFont });
  }
  return runs.length > 0 ? runs : [{ text: "", font: bold ? "Latin-Bold" : "Latin" }];
}

function normalizePdfText(text: string): string {
  let normalized = "";
  for (const segment of graphemeSegments(text)) {
    if (segment === "\t") normalized += "    ";
    else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(segment)) normalized += "";
    else normalized += segment;
  }
  return normalized;
}

function drawMixedParagraph(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number): void {
  const lines = wrapMixedText(doc, normalizePdfText(text), width);
  const lineHeight = doc.currentLineHeight(true);
  for (let i = 0; i < lines.length; i++) {
    let cursorX = x;
    for (const run of lines[i]) {
      doc.font(run.font).text(run.text, cursorX, y + i * lineHeight, { lineBreak: false });
      cursorX += doc.widthOfString(run.text);
    }
  }
}

function measureMixedParagraphHeight(doc: PDFKit.PDFDocument, text: string, width: number, fontSize: number): number {
  doc.fontSize(fontSize);
  const lines = wrapMixedText(doc, normalizePdfText(text), width);
  return Math.max(lines.length, 1) * doc.currentLineHeight(true);
}

function wrapMixedText(doc: PDFKit.PDFDocument, text: string, width: number): Array<Array<{ text: string; font: string }>> {
  const lines: Array<Array<{ text: string; font: string }>> = [];
  let line: Array<{ text: string; font: string }> = [];
  let lineWidth = 0;

  for (const token of tokenizePdfText(text)) {
    if (token === "\n") {
      lines.push(line);
      line = [];
      lineWidth = 0;
      continue;
    }

    const tokenRuns = splitFontRuns(token, false);
    const tokenWidth = measureRunsWidth(doc, tokenRuns);
    if (line.length > 0 && lineWidth + tokenWidth > width) {
      lines.push(trimLineEnd(line));
      line = [];
      lineWidth = 0;
    }

    if (tokenWidth <= width) {
      line.push(...tokenRuns);
      lineWidth += tokenWidth;
      continue;
    }

    for (const segment of graphemeSegments(token)) {
      const segmentRuns = splitFontRuns(segment, false);
      const segmentWidth = measureRunsWidth(doc, segmentRuns);
      if (line.length > 0 && lineWidth + segmentWidth > width) {
        lines.push(trimLineEnd(line));
        line = [];
        lineWidth = 0;
      }
      line.push(...segmentRuns);
      lineWidth += segmentWidth;
    }
  }

  lines.push(trimLineEnd(line));
  return lines;
}

function tokenizePdfText(text: string): string[] {
  return text.match(/\n|\S+\s*/gu) ?? [text];
}

function measureRunsWidth(doc: PDFKit.PDFDocument, runs: Array<{ text: string; font: string }>): number {
  return runs.reduce((total, run) => {
    doc.font(run.font);
    return total + doc.widthOfString(run.text);
  }, 0);
}

function trimLineEnd(line: Array<{ text: string; font: string }>): Array<{ text: string; font: string }> {
  const trimmed = [...line];
  while (trimmed.length > 0 && /^\s+$/.test(trimmed[trimmed.length - 1].text)) trimmed.pop();
  if (trimmed.length > 0) {
    trimmed[trimmed.length - 1] = { ...trimmed[trimmed.length - 1], text: trimmed[trimmed.length - 1].text.replace(/\s+$/u, "") };
  }
  return trimmed;
}

function graphemeSegments(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

function fontForPdfSegment(segment: string, bold: boolean): string {
  if (EMOJI_RE.test(segment)) return "Emoji";
  if (THAI_TEXT_RE.test(segment)) return bold ? "Thai-Bold" : "Thai";
  if (MATH_TEXT_RE.test(segment)) return "Math";
  if (SYMBOLS_2_TEXT_RE.test(segment)) return "Symbols2";
  if (SYMBOLS_TEXT_RE.test(segment)) return "Symbols";
  return bold ? "Latin-Bold" : "Latin";
}
