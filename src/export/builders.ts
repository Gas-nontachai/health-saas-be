import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type ExportRecord = {
  datetime: Date;
  bloodSugar: number;
  medMorning: number | null;
  medEvening: number | null;
  note: string | null;
};

export async function buildExcel(records: ExportRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Blood Sugar Records");

  sheet.columns = [
    { header: "Datetime (UTC)", key: "datetime", width: 28 },
    { header: "Blood Sugar", key: "bloodSugar", width: 14 },
    { header: "Morning Medicine", key: "medMorning", width: 18 },
    { header: "Evening Medicine", key: "medEvening", width: 18 },
    { header: "Note", key: "note", width: 40 }
  ];

  for (const record of records) {
    sheet.addRow({
      datetime: record.datetime.toISOString(),
      bloodSugar: record.bloodSugar,
      medMorning: record.medMorning ?? "",
      medEvening: record.medEvening ?? "",
      note: record.note ?? ""
    });
  }

  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildPdf(records: ExportRecord[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Blood Sugar Records", { underline: true });
    doc.moveDown();

    if (records.length === 0) {
      doc.fontSize(11).text("No records found.");
      doc.end();
      return;
    }

    doc.fontSize(10);
    for (const record of records) {
      const line = [
        record.datetime.toISOString(),
        `Blood sugar: ${record.bloodSugar}`,
        `Morning med: ${record.medMorning ?? "-"}`,
        `Evening med: ${record.medEvening ?? "-"}`,
        record.note ? `Note: ${record.note}` : undefined
      ]
        .filter(Boolean)
        .join(" | ");

      doc.text(line);
      doc.moveDown(0.35);
    }

    doc.end();
  });
}
