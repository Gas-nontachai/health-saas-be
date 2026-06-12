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
} from "../../weight/forecast.js";

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
  dataTypes?: ("bloodSugar" | "weight")[];
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

export type HealthReportInput = Required<Pick<UnifiedHealthExportInput, "dataTypes" | "exportedAt" | "patientName" | "patientEmail">> &
  Pick<UnifiedHealthExportInput, "bloodSugar" | "weight">;

export type HealthReportMetadata = {
  reportType: "Blood Sugar Report" | "Weight Progress Report" | "Health Report";
  metricsIncluded: string[];
  patientName: string;
  patientEmail: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  timeZone: "Asia/Bangkok";
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
  return buildUnifiedHealthExcel({
    dataTypes: ["bloodSugar"],
    bloodSugar: { records, context: ctx },
    exportedAt: ctx.exportedAt,
    patientName: ctx.patientName,
    patientEmail: ctx.patientEmail
  });
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

const REPORT_TIME_ZONE = "Asia/Bangkok";

type MetricReportSection = {
  key: "bloodSugar" | "weight";
  label: string;
  reportTitle: "Blood Sugar Report" | "Weight Progress Report";
  dataSheetName: string;
  periodDates: Date[];
  summaryRows: [string, string | number][];
  latestValue: string;
  status: string;
  addExcelSheet: (workbook: ExcelJS.Workbook, sheetName: string) => void;
  drawPdfSection: (doc: PDFKit.PDFDocument) => void;
};

function buildHealthReportInput(input: UnifiedHealthExportInput): HealthReportInput {
  const dataTypes = input.dataTypes ?? [input.bloodSugar ? "bloodSugar" : null, input.weight ? "weight" : null].filter(Boolean) as ("bloodSugar" | "weight")[];
  return {
    dataTypes,
    bloodSugar: input.bloodSugar,
    weight: input.weight,
    exportedAt: input.exportedAt,
    patientName: input.patientName,
    patientEmail: input.patientEmail
  };
}

function buildMetricSections(input: HealthReportInput): MetricReportSection[] {
  const sections: MetricReportSection[] = [];
  for (const dataType of input.dataTypes) {
    if (dataType === "bloodSugar" && input.bloodSugar) sections.push(buildBloodSugarReportSection(input.bloodSugar.records));
    if (dataType === "weight" && input.weight) sections.push(buildWeightReportSection(input.weight.entries, input.weight.goal));
  }
  return sections;
}

function buildBloodSugarReportSection(records: ExportRecord[]): MetricReportSection {
  const stats = computeStats(records);
  const measuredRecords = records.filter(isMeasuredBloodSugar);
  const latest = measuredRecords.at(-1);
  const summaryRows: [string, string | number][] = [
    ["Latest Reading", latest ? `${latest.bloodSugar} mg/dL` : "-"],
    ["Average Reading", stats ? `${stats.avg} mg/dL` : "-"],
    ["Highest Reading", stats ? `${stats.max} mg/dL` : "-"],
    ["Lowest Reading", stats ? `${stats.min} mg/dL` : "-"]
  ];
  return {
    key: "bloodSugar",
    label: "Blood Sugar",
    reportTitle: "Blood Sugar Report",
    dataSheetName: "Blood Sugar Data",
    periodDates: records.map((record) => record.datetime),
    summaryRows,
    latestValue: latest ? `${latest.bloodSugar} mg/dL` : "-",
    status: latest ? classifyBloodSugar(latest.bloodSugar) : "insufficient_data",
    addExcelSheet: (workbook, sheetName) => addBloodSugarSheet(workbook, records, sheetName),
    drawPdfSection: (doc) => drawBloodSugarReportSection(doc, records, summaryRows)
  };
}

function buildWeightReportSection(entries: MetricEntryRow[], goal: GoalRow | null): MetricReportSection {
  const summary = buildWeightProgressSummary(entries, goal);
  const summaryRows: [string, string | number][] = [
    ["Current Weight", summary.currentValue === null ? "-" : `${summary.currentValue} kg`],
    ["Change", summary.totalChange === null ? "-" : `${summary.totalChange} kg`],
    ["Goal Weight", goal ? `${round1(goal.targetValue)} kg` : "-"],
    ["Progress", summary.progressPercent === null ? "-" : `${summary.progressPercent}%`]
  ];
  return {
    key: "weight",
    label: "Weight",
    reportTitle: "Weight Progress Report",
    dataSheetName: "Weight Data",
    periodDates: entries.map((entry) => entry.date),
    summaryRows,
    latestValue: summary.currentValue === null ? "-" : `${summary.currentValue} kg`,
    status: summary.status,
    addExcelSheet: (workbook, sheetName) => addWeightLogSheet(workbook, entries, goal, sheetName),
    drawPdfSection: (doc) => drawWeightReportSection(doc, entries, goal, summaryRows)
  };
}

export function buildHealthReportMetadata(input: HealthReportInput): HealthReportMetadata {
  const sections = buildMetricSections(input);
  const periodDates = sections.flatMap((section) => section.periodDates).sort((a, b) => a.getTime() - b.getTime());
  const isMultiMetric = sections.length > 1;
  return {
    reportType: isMultiMetric ? "Health Report" : sections[0]?.reportTitle ?? "Health Report",
    metricsIncluded: sections.map((section) => section.label),
    patientName: input.patientName,
    patientEmail: input.patientEmail,
    periodStart: periodDates[0] ? formatDateIct(periodDates[0]) : "-",
    periodEnd: periodDates.at(-1) ? formatDateIct(periodDates.at(-1) as Date) : "-",
    generatedAt: formatDateTimeIct(input.exportedAt),
    timeZone: REPORT_TIME_ZONE
  };
}

export function buildHealthReportFilename(dataTypes: readonly ("bloodSugar" | "weight")[], type: "excel" | "pdf", exportedAt: Date): string {
  const extension = type === "excel" ? "xlsx" : "pdf";
  const date = formatFilenameDateIct(exportedAt);
  if (dataTypes.length === 1) {
    return `${dataTypes[0] === "bloodSugar" ? "blood-sugar" : "weight"}-report-${date}.${extension}`;
  }
  return `health-report-${date}.${extension}`;
}

function formatFilenameDateIct(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}${parts.find((part) => part.type === "month")?.value}${parts.find((part) => part.type === "day")?.value}`;
}

function formatDateIct(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatTimeIct(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateTimeIct(date: Date): string {
  return `${formatDateIct(date)} ${formatTimeIct(date).slice(0, 5)} ICT`;
}

function formatReportPeriod(metadata: HealthReportMetadata): string {
  if (metadata.periodStart === "-" && metadata.periodEnd === "-") return "-";
  return `${metadata.periodStart} - ${metadata.periodEnd}`;
}

function addMetadataRows(sheet: ExcelJS.Worksheet, metadata: HealthReportMetadata): void {
  sheet.addRow(["Report Type", metadata.reportType]);
  sheet.addRow(["Metrics Included", metadata.metricsIncluded.join(", ")]);
  sheet.addRow(["Patient Name", metadata.patientName]);
  sheet.addRow(["Period Start", metadata.periodStart]);
  sheet.addRow(["Period End", metadata.periodEnd]);
  sheet.addRow(["Generated At", metadata.generatedAt]);
  sheet.addRow(["Time Zone", metadata.timeZone]);
}

// ══════════════════════════════════════════════
//  WEIGHT PROGRESS EXPORT BUILDERS
// ══════════════════════════════════════════════

export async function buildWeightProgressExcel(
  entries: MetricEntryRow[],
  goal: GoalRow | null,
  ctx: WeightProgressContext
): Promise<Buffer> {
  return buildUnifiedHealthExcel({
    dataTypes: ["weight"],
    weight: { entries, goal, context: ctx },
    exportedAt: ctx.exportedAt,
    patientName: ctx.patientName,
    patientEmail: ctx.patientEmail
  });
}

export function buildWeightProgressPdf(entries: MetricEntryRow[], goal: GoalRow | null, ctx: WeightProgressContext): Promise<Buffer> {
  return buildUnifiedHealthPdf({
    dataTypes: ["weight"],
    weight: { entries, goal, context: ctx },
    exportedAt: ctx.exportedAt,
    patientName: ctx.patientName,
    patientEmail: ctx.patientEmail
  });
}

export async function buildUnifiedHealthExcel(input: UnifiedHealthExportInput): Promise<Buffer> {
  const reportInput = buildHealthReportInput(input);
  const sections = buildMetricSections(reportInput);
  const metadata = buildHealthReportMetadata(reportInput);
  const isMultiMetric = sections.length > 1;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Health SaaS";
  workbook.created = input.exportedAt;

  const summary = workbook.addWorksheet(isMultiMetric ? "Overview" : "Summary");
  summary.columns = [{ width: 28 }, { width: 42 }, { width: 24 }];
  const titleRow = summary.addRow([metadata.reportType]);
  titleRow.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 16 };
  summary.mergeCells("A1:C1");
  summary.addRow([]);
  addMetadataRows(summary, metadata);
  summary.addRow([]);

  if (isMultiMetric) {
    const executiveHeader = summary.addRow(["Metric", "Latest Value", "Status"]);
    styleOverviewHeader(executiveHeader);
    for (const section of sections) {
      summary.addRow([section.label, section.latestValue, section.status]);
    }
  } else {
    const section = sections[0];
    if (section) {
      const metricHeader = summary.addRow([section.label]);
      metricHeader.font = { name: EXPORT_FONT_FAMILY, bold: true, size: 13 };
      for (const row of section.summaryRows) summary.addRow(row);
    }
  }
  styleLabelColumn(summary);

  for (const section of sections) {
    section.addExcelSheet(workbook, isMultiMetric ? section.label : section.dataSheetName);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildUnifiedHealthPdf(input: UnifiedHealthExportInput): Promise<Buffer> {
  const reportInput = buildHealthReportInput(input);
  const sections = buildMetricSections(reportInput);
  const metadata = buildHealthReportMetadata(reportInput);
  const isMultiMetric = sections.length > 1;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerPdfFonts(doc);

    if (isMultiMetric) {
      drawReportHeader(doc, metadata);
      doc.moveDown(0.8);
      doc.fontSize(11).font("Latin-Bold").fillColor("#111111").text("Executive Summary", TABLE_LEFT);
      doc.moveDown(0.2);
      drawExecutiveSummaryTable(doc, sections);
      for (let i = 0; i < sections.length; i++) {
        doc.addPage();
        doc.fontSize(14).font("Latin-Bold").fillColor("#111111").text(`${i + 1}. ${sections[i].reportTitle}`, TABLE_LEFT);
        doc.moveDown(0.5);
        sections[i].drawPdfSection(doc);
      }
    } else {
      drawReportHeader(doc, metadata);
      doc.moveDown(0.8);
      sections[0]?.drawPdfSection(doc);
    }

    drawUnifiedPageFooters(doc, reportInput);
    doc.end();
  });
}

function addBloodSugarSheet(workbook: ExcelJS.Workbook, records: ExportRecord[], sheetName = "Blood Sugar"): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Time", key: "time", width: 12 },
    { header: "Reading", key: "bloodSugar", width: 16 },
    { header: "Status", key: "status", width: 14 }
  ];
  styleWeightLogHeader(sheet);
  records.forEach((record) => {
    sheet.addRow({
      date: formatDateIct(record.datetime),
      time: formatTimeIct(record.datetime),
      bloodSugar: record.bloodSugar,
      status: classifyBloodSugar(record.bloodSugar)
    });
  });
  sheet.autoFilter = { from: "A1", to: `D${records.length + 1}` };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function addWeightLogSheet(workbook: ExcelJS.Workbook, entries: MetricEntryRow[], goal: GoalRow | null, sheetName = "Weight"): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Weight", key: "weight", width: 14 },
    { header: "7-Day Average", key: "rollingAverage", width: 16 },
    { header: "Forecast", key: "forecast", width: 16 },
    { header: "Delta", key: "delta", width: 18 }
  ];
  styleWeightLogHeader(sheet);
  const rollingAverage = buildRollingAverageSeries(entries);
  entries.forEach((entry, index) => {
    const forecastValue = goal ? round1(interpolateForecast(goal, entry.date)) : null;
    sheet.addRow({
      date: formatDate(entry.date),
      weight: round1(entry.value),
      rollingAverage: rollingAverage[index].value,
      forecast: forecastValue ?? "-",
      delta: forecastValue !== null ? round1(entry.value - forecastValue) : "-"
    });
  });
  sheet.autoFilter = { from: "A1", to: `E${entries.length + 1}` };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function styleOverviewHeader(row: ExcelJS.Row): void {
  row.font = { name: EXPORT_FONT_FAMILY, bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5090" } };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function drawReportHeader(doc: PDFKit.PDFDocument, metadata: HealthReportMetadata): void {
  doc
    .fontSize(6.5)
    .font("Latin")
    .fillColor("#999999")
    .text(`Generated At: ${metadata.generatedAt}`, doc.page.width - 230, 24, {
      width: 190,
      align: "right",
      lineBreak: false
    });

  doc.y = 64;
  doc.fontSize(18).font("Latin-Bold").fillColor("#111111").text(metadata.reportType, 40, doc.y, {
    width: doc.page.width - 80,
    align: "center"
  });
  doc.moveDown(0.35);
  doc.fontSize(9).font("Latin").fillColor("#555555");
  drawCenteredFallbackLine(doc, `Patient: ${metadata.patientName}`);
  doc.y += 3;
  drawCenteredFallbackLine(doc, `Period: ${formatReportPeriod(metadata)}`);
  doc.y += 3;
  drawCenteredFallbackLine(doc, `Metrics Included: ${metadata.metricsIncluded.join(", ")}`);
  doc.y += 3;
  drawCenteredFallbackLine(doc, `Time Zone: ${metadata.timeZone}`);
}

function drawExecutiveSummaryTable(doc: PDFKit.PDFDocument, sections: MetricReportSection[]): void {
  const widths = [150, 170, 150];
  const headers = ["Metric", "Latest Value", "Status"];
  drawSimplePdfRow(doc, headers, widths, true);
  for (const section of sections) {
    drawSimplePdfRow(doc, [section.label, section.latestValue, section.status], widths);
  }
}

function drawBloodSugarReportSection(doc: PDFKit.PDFDocument, records: ExportRecord[], summaryRows: [string, string | number][]): void {
  drawSummaryRows(doc, summaryRows);
  doc.moveDown(0.6);
  doc.fontSize(10).font("Latin-Bold").fillColor("#111111").text("Detail", TABLE_LEFT);
  doc.moveDown(0.2);
  const widths = [130, 90, 120, 120];
  drawSimplePdfRow(doc, ["Date", "Time", "Reading", "Status"], widths, true);
  for (const record of records) {
    if (doc.y + 22 > doc.page.height - PDF_BOTTOM) {
      doc.addPage();
      drawSimplePdfRow(doc, ["Date", "Time", "Reading", "Status"], widths, true);
    }
    drawSimplePdfRow(doc, [formatDateIct(record.datetime), formatTimeIct(record.datetime), String(record.bloodSugar), classifyBloodSugar(record.bloodSugar)], widths);
  }
  if (records.length === 0) doc.fontSize(9).font("Latin").fillColor("#000000").text("No records found.", TABLE_LEFT);
}

function drawWeightReportSection(doc: PDFKit.PDFDocument, entries: MetricEntryRow[], goal: GoalRow | null, summaryRows: [string, string | number][]): void {
  drawSummaryRows(doc, summaryRows);
  doc.moveDown(0.6);
  doc.fontSize(10).font("Latin-Bold").fillColor("#111111").text("Detail", TABLE_LEFT);
  doc.moveDown(0.2);
  const widths = [105, 85, 105, 95, 80];
  const rollingAverage = buildRollingAverageSeries(entries);
  drawSimplePdfRow(doc, ["Date", "Weight", "7-Day Average", "Forecast", "Delta"], widths, true);
  for (let i = 0; i < entries.length; i++) {
    if (doc.y + 22 > doc.page.height - PDF_BOTTOM) {
      doc.addPage();
      drawSimplePdfRow(doc, ["Date", "Weight", "7-Day Average", "Forecast", "Delta"], widths, true);
    }
    const entry = entries[i];
    const forecastValue = goal ? round1(interpolateForecast(goal, entry.date)) : null;
    drawSimplePdfRow(doc, [
      formatDate(entry.date),
      `${round1(entry.value)} kg`,
      String(rollingAverage[i].value),
      forecastValue !== null ? String(forecastValue) : "-",
      forecastValue !== null ? String(round1(entry.value - forecastValue)) : "-"
    ], widths);
  }
  if (entries.length === 0) doc.fontSize(9).font("Latin").fillColor("#000000").text("No weight entries found.", TABLE_LEFT);
}

function drawSummaryRows(doc: PDFKit.PDFDocument, rows: [string, string | number][]): void {
  doc.fontSize(10).font("Latin-Bold").fillColor("#111111").text("Summary", TABLE_LEFT);
  doc.moveDown(0.2);
  for (const [label, value] of rows) {
    doc.fontSize(8.5).font("Latin").fillColor("#333333").text(`${label}: ${value}`, TABLE_LEFT);
  }
}

function drawSimplePdfRow(doc: PDFKit.PDFDocument, cells: string[], widths: number[], isHeader = false): void {
  const rowHeight = 22;
  const rowTop = doc.y;
  let x = TABLE_LEFT;
  if (isHeader) {
    doc.save().rect(TABLE_LEFT, rowTop, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill(HEADER_BG).restore();
  }
  doc.fontSize(7.5).font(isHeader ? "Latin-Bold" : "Latin").fillColor(isHeader ? "#FFFFFF" : "#000000");
  for (let i = 0; i < cells.length; i++) {
    doc.text(cells[i], x + 3, rowTop + 6, { width: widths[i] - 6, ellipsis: true, lineBreak: false });
    x += widths[i];
  }
  doc
    .save()
    .moveTo(TABLE_LEFT, rowTop + rowHeight)
    .lineTo(TABLE_LEFT + widths.reduce((sum, width) => sum + width, 0), rowTop + rowHeight)
    .lineWidth(0.3)
    .strokeColor("#D0D0D0")
    .stroke()
    .restore();
  doc.y = rowTop + rowHeight;
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
  return buildUnifiedHealthPdf({
    dataTypes: ["bloodSugar"],
    bloodSugar: { records, context: ctx },
    exportedAt: ctx.exportedAt,
    patientName: ctx.patientName,
    patientEmail: ctx.patientEmail
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
