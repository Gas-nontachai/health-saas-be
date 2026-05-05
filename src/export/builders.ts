import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

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
  total: number;
  avg: number;
  min: number;
  max: number;
  normalCount: number;
  highCount: number;
  lowCount: number;
};

// ————— Blood sugar classification (mg/dL) —————
const BS_LOW = 70;
const BS_HIGH = 180;

function classifyBloodSugar(value: number): "Low" | "Normal" | "High" {
  if (value < BS_LOW) return "Low";
  if (value > BS_HIGH) return "High";
  return "Normal";
}

function computeStats(records: ExportRecord[]): RecordStats | null {
  if (records.length === 0) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let lowCount = 0;
  let normalCount = 0;
  let highCount = 0;

  for (const r of records) {
    sum += r.bloodSugar;
    if (r.bloodSugar < min) min = r.bloodSugar;
    if (r.bloodSugar > max) max = r.bloodSugar;
    const cls = classifyBloodSugar(r.bloodSugar);
    if (cls === "Low") lowCount++;
    else if (cls === "High") highCount++;
    else normalCount++;
  }

  return {
    total: records.length,
    avg: Math.round(sum / records.length),
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
  titleRow.font = { bold: true, size: 16 };
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
    statsHeader.font = { bold: true, size: 13 };
    summary.addRow(["Date Range", dateRange]);
    summary.addRow(["Total Records", stats.total]);
    summary.addRow(["Average (mg/dL)", stats.avg]);
    summary.addRow(["Min (mg/dL)", stats.min]);
    summary.addRow(["Max (mg/dL)", stats.max]);
    summary.addRow([]);
    summary.addRow(["Normal (70–180 mg/dL)", `${stats.normalCount} (${pct(stats.normalCount, stats.total)})`]);
    summary.addRow(["Low (< 70 mg/dL)", `${stats.lowCount} (${pct(stats.lowCount, stats.total)})`]);
    summary.addRow(["High (> 180 mg/dL)", `${stats.highCount} (${pct(stats.highCount, stats.total)})`]);
  } else {
    summary.addRow(["No records found."]);
  }

  styleLabelColumn(summary);

  // ——— Records Sheet ———
  const sheet = workbook.addWorksheet("Records");

  sheet.columns = [
    { header: "#", key: "no", width: 6 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time (UTC)", key: "time", width: 12 },
    { header: "Blood Sugar\n(mg/dL)", key: "bloodSugar", width: 14 },
    { header: "Status", key: "status", width: 10 },
    { header: "Morning Med", key: "medMorning", width: 14 },
    { header: "Evening Med", key: "medEvening", width: 14 },
    { header: "Note", key: "note", width: 36 }
  ];

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
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

    row.alignment = { vertical: "middle" };
    row.getCell("bloodSugar").alignment = { horizontal: "center" };
    row.getCell("status").alignment = { horizontal: "center" };
    row.getCell("no").alignment = { horizontal: "center" };

    // Alternate row shading
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      });
    }

    // Color-code blood sugar status
    const statusCell = row.getCell("status");
    if (status === "Low") {
      statusCell.font = { bold: true, color: { argb: "FFCC6600" } };
    } else if (status === "High") {
      statusCell.font = { bold: true, color: { argb: "FFCC0000" } };
    } else {
      statusCell.font = { color: { argb: "FF007A33" } };
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
    const cell = row.getCell(1);
    if (typeof cell.value === "string" && cell.value && !row.font?.size) {
      cell.font = { ...cell.font, bold: true };
    }
  });
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

// ══════════════════════════════════════════════
//  PDF BUILDER
// ══════════════════════════════════════════════

const COL_WIDTHS = [28, 70, 55, 72, 52, 64, 64, 110];
const TABLE_LEFT = 40;
const ROW_HEIGHT = 18;
const HEADER_BG = "#2E5090";

export function buildPdf(records: ExportRecord[], ctx: ExportContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape", bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const stats = computeStats(records);

    // ——— Header ———
    doc.fontSize(18).font("Helvetica-Bold").text("Blood Sugar Report", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#555555");
    doc.text(`Patient: ${ctx.patientName}  |  Email: ${ctx.patientEmail}`, { align: "center" });
    const profileParts = [
      ctx.weight ? `Weight: ${ctx.weight} kg` : null,
      ctx.height ? `Height: ${ctx.height} cm` : null
    ].filter(Boolean);
    if (profileParts.length > 0) {
      doc.text(profileParts.join("  |  "), { align: "center" });
    }
    doc.text(`Exported: ${formatDatetime(ctx.exportedAt)}`, { align: "center" });
    doc.moveDown(0.5);

    // ——— Summary Stats ———
    if (stats) {
      const dateRange =
        records.length > 0 ? `${formatDateOnly(records[0].datetime)} — ${formatDateOnly(records[records.length - 1].datetime)}` : "-";

      doc.fillColor("#000000").fontSize(10).font("Helvetica-Bold").text("Summary", TABLE_LEFT);
      doc.moveDown(0.2);
      doc.fontSize(8).font("Helvetica").fillColor("#333333");
      doc.text(
        `Period: ${dateRange}  |  Records: ${stats.total}  |  Avg: ${stats.avg} mg/dL  |  Min: ${stats.min} mg/dL  |  Max: ${stats.max} mg/dL`,
        TABLE_LEFT
      );
      doc.text(
        `Normal (70–180): ${stats.normalCount} (${pct(stats.normalCount, stats.total)})  |  ` +
          `Low (<70): ${stats.lowCount} (${pct(stats.lowCount, stats.total)})  |  ` +
          `High (>180): ${stats.highCount} (${pct(stats.highCount, stats.total)})`,
        TABLE_LEFT
      );
      doc.moveDown(0.5);
    }

    if (records.length === 0) {
      doc.fontSize(11).fillColor("#000000").text("No records found.");
      doc.end();
      return;
    }

    // ——— Table ———
    const headers = ["#", "Date", "Time", "Blood Sugar", "Status", "Morning Med", "Evening Med", "Note"];

    drawTableHeader(doc, headers);

    for (let i = 0; i < records.length; i++) {
      const y = doc.y;

      // Check if we need a new page
      if (y + ROW_HEIGHT > doc.page.height - 50) {
        doc.addPage();
        drawTableHeader(doc, headers);
      }

      const r = records[i];
      const iso = r.datetime.toISOString();
      const status = classifyBloodSugar(r.bloodSugar);

      // Alternate row background
      if (i % 2 === 1) {
        doc.save().rect(TABLE_LEFT, doc.y, COL_WIDTHS.reduce((a, b) => a + b, 0), ROW_HEIGHT).fill("#F2F6FA").restore();
      }

      const rowY = doc.y + 5;
      const cells = [
        String(i + 1),
        iso.slice(0, 10),
        iso.slice(11, 19),
        String(r.bloodSugar),
        status,
        r.medMorning != null ? String(r.medMorning) : "-",
        r.medEvening != null ? String(r.medEvening) : "-",
        r.note ?? ""
      ];

      let x = TABLE_LEFT;
      doc.fontSize(7).font("Helvetica").fillColor("#000000");
      for (let c = 0; c < cells.length; c++) {
        // Color status column
        if (c === 4) {
          if (cells[c] === "Low") doc.fillColor("#CC6600");
          else if (cells[c] === "High") doc.fillColor("#CC0000");
          else doc.fillColor("#007A33");
          doc.font("Helvetica-Bold");
        }

        doc.text(cells[c], x + 3, rowY, { width: COL_WIDTHS[c] - 6, ellipsis: true, lineBreak: false });

        if (c === 4) {
          doc.fillColor("#000000").font("Helvetica");
        }
        x += COL_WIDTHS[c];
      }

      // Row border
      const rowBottom = doc.y - 5 + ROW_HEIGHT;
      doc.save().moveTo(TABLE_LEFT, rowBottom).lineTo(TABLE_LEFT + COL_WIDTHS.reduce((a, b) => a + b, 0), rowBottom).lineWidth(0.3).strokeColor("#D0D0D0").stroke().restore();

      doc.y = rowBottom;
    }

    // ——— Footer on every page ———
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font("Helvetica").fillColor("#999999");
      doc.text(`Page ${i + 1} of ${pageCount}  —  Blood Sugar Report  —  ${ctx.patientName}`, TABLE_LEFT, doc.page.height - 30, {
        width: doc.page.width - 80,
        align: "center"
      });
    }

    doc.end();
  });
}

function drawTableHeader(doc: PDFKit.PDFDocument, headers: string[]): void {
  const tableWidth = COL_WIDTHS.reduce((a, b) => a + b, 0);

  // Header background
  doc.save().rect(TABLE_LEFT, doc.y, tableWidth, ROW_HEIGHT + 2).fill(HEADER_BG).restore();

  const headerY = doc.y + 5;
  let x = TABLE_LEFT;
  doc.fontSize(7).font("Helvetica-Bold").fillColor("#FFFFFF");
  for (let c = 0; c < headers.length; c++) {
    doc.text(headers[c], x + 3, headerY, { width: COL_WIDTHS[c] - 6, lineBreak: false });
    x += COL_WIDTHS[c];
  }

  doc.y = headerY - 5 + ROW_HEIGHT + 2;
  doc.fillColor("#000000");
}
