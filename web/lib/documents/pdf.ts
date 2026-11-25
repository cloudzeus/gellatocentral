// Πραγματικό PDF στο Node runtime· το κείμενο γράφεται ως δεδομένα, όχι ως HTML/markup.
import path from "node:path";
import PDFDocument from "pdfkit";
import type { DocumentModel, DocumentSection } from "./model";

const REGULAR = path.join(process.cwd(), "lib", "documents", "assets", "NotoSans-Regular.ttf");
const BOLD = path.join(process.cwd(), "lib", "documents", "assets", "NotoSans-Bold.ttf");
const PAGE_WIDTH = 595.28;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").slice(0, 20_000);
}

export async function createDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: 58, left: MARGIN, right: MARGIN }, bufferPages: true, info: { Title: clean(model.title), Author: clean(model.brand.legalName || model.brand.name), Subject: "Gelato System document" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });

  const brandLine = [model.brand.address, [model.brand.postalCode, model.brand.city].filter(Boolean).join(" "), model.brand.phone].filter(Boolean).join(" · ");
  doc.font(REGULAR).fontSize(9).fillColor("#444444").text(clean(model.brand.legalName || model.brand.name), { width: CONTENT_WIDTH });
  doc.text(`ΑΦΜ ${clean(model.brand.vatNumber)}${brandLine ? ` · ${clean(brandLine)}` : ""}`, { width: CONTENT_WIDTH });
  doc.moveDown(0.7).moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor("#888888").lineWidth(0.6).stroke();
  doc.moveDown(1).font(BOLD).fontSize(19).fillColor("#111111").text(clean(model.title), { width: CONTENT_WIDTH });
  if (model.subtitle) doc.moveDown(0.25).font(REGULAR).fontSize(10).fillColor("#555555").text(clean(model.subtitle), { width: CONTENT_WIDTH });
  doc.moveDown(1);

  const ensureSpace = (height: number) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const paragraph = (value: string, options: { bold?: boolean; size?: number; color?: string } = {}) => {
    doc.font(options.bold ? BOLD : REGULAR).fontSize(options.size ?? 9.5).fillColor(options.color ?? "#222222");
    const height = doc.heightOfString(clean(value), { width: CONTENT_WIDTH });
    ensureSpace(height + 5);
    doc.text(clean(value), MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.35);
  };
  const table = (section: NonNullable<DocumentSection["table"]>) => {
    const columns = Math.max(1, section.headers.length);
    const width = CONTENT_WIDTH / columns;
    const drawRow = (values: string[], header = false) => {
      doc.font(header ? BOLD : REGULAR).fontSize(8.5);
      const cells = values.slice(0, columns).map(clean);
      while (cells.length < columns) cells.push("");
      const heights = cells.map((value) => doc.heightOfString(value, { width: width - 8 }));
      const height = Math.max(20, ...heights.map((cellHeight) => cellHeight + 9));
      ensureSpace(height + 2);
      const y = doc.y;
      cells.forEach((value, index) => doc.text(value, MARGIN + index * width + 4, y + 4, { width: width - 8, lineGap: 1 }));
      doc.moveTo(MARGIN, y + height).lineTo(PAGE_WIDTH - MARGIN, y + height).strokeColor(header ? "#555555" : "#dddddd").lineWidth(header ? 0.8 : 0.35).stroke();
      doc.y = y + height + 2;
      doc.x = MARGIN;
    };
    drawRow(section.headers, true);
    section.rows.forEach((row) => drawRow(row));
    doc.moveDown(0.5);
  };

  for (const section of model.sections) {
    doc.font(BOLD).fontSize(12).fillColor("#111111");
    ensureSpace(doc.heightOfString(section.title, { width: CONTENT_WIDTH }) + 24);
    doc.text(clean(section.title), { width: CONTENT_WIDTH });
    doc.moveDown(0.35);
    for (const field of section.fields ?? []) paragraph(`${clean(field.label)}: ${clean(field.value)}`);
    for (const text of section.paragraphs ?? []) paragraph(text);
    if (section.table) table(section.table);
    doc.moveDown(0.5);
  }
  if (model.brand.labelExtraText) {
    ensureSpace(45);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor("#aaaaaa").lineWidth(0.4).stroke();
    doc.moveDown(0.5);
    paragraph(model.brand.labelExtraText, { size: 8, color: "#555555" });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Το footer γράφεται εκτός flow, ώστε να μη δημιουργεί ψευδή κενή τελευταία σελίδα.
    doc.page.margins.bottom = 0;
    doc.font(REGULAR).fontSize(8).fillColor("#666666").text(`Gelato System · Σελίδα ${index + 1} / ${range.count}`, MARGIN, doc.page.height - 38, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
  }
  doc.end();
  return finished;
}
