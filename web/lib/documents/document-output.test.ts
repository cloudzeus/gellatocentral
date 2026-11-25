import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test, type TestContext } from "node:test";
import ExcelJS from "exceljs";
import type { DocumentModel } from "./model.ts";
import type { WholesaleQuoteDocumentData } from "./load.ts";
import type { StockContext } from "../stock-scope.ts";
import type { ScheduleExportShift } from "../schedule-export.ts";

type ResolveHooks = { registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown): unknown }): void };
(nodeModule as unknown as ResolveHooks).registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || /\.[a-z]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.${specifier.startsWith(".") ? "ts" : "js"}`, context);
    }
  },
});
const { createDocumentPdf } = await import("./pdf.ts");
const { documentFilename } = await import("./model.ts");
const { buildWholesaleQuoteDocument, loadDocument, monthBounds } = await import("./load.ts");
const { db } = await import("../db.ts");
const { csvCell, icsEscape, icsFold, scheduleCsv, scheduleIcs, scheduleShifts, scheduleXlsx } = await import("../schedule-export.ts");

const model: DocumentModel = {
  entityType: "recipe", entityId: "recipe-1", filename: "συνταγή/<script>", title: "Τεχνικό δελτίο — Παγωτό",
  brand: { name: "Επιχείρηση", legalName: "Επιχείρηση ΑΕ", vatNumber: "123456789", address: "Οδός 1", city: "Αθήνα", postalCode: "10000", phone: null, labelExtraText: "Πρόσθετο κείμενο ετικέτας" },
  sections: [{ title: "Συστατικά", paragraphs: ["Κείμενο <script>alert(1)</script> χωρίς εκτέλεση markup"], table: { headers: ["Α΄ ύλη", "Ποσότητα"], rows: [["Γάλα", "1,5 kg"]] } }],
};
const shift: ScheduleExportShift = { id: "shift-1", employeeId: "employee-1", employeeName: "=HYPERLINK(\"https://invalid\")", startsAt: "2026-11-24T08:00:00.000Z", endsAt: "2026-11-24T16:00:00.000Z", breakMinutes: 30, note: "Σημείωση, με κόμμα\nκαι νέα γραμμή", departmentName: "Παραγωγή", storeName: "Κέντρο" };

test("PDF: πραγματικό αρχείο με ελληνικά, branding και έγκυρες υπογραφές", async () => {
  const bytes = await createDocumentPdf(model);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
  assert.equal(Buffer.from(bytes.subarray(-7)).includes("%%EOF"), true);
  assert.ok(bytes.byteLength > 2_000);
  assert.equal(documentFilename(model, "pdf").includes("/"), false);
  assert.equal(documentFilename(model, "pdf").endsWith(".pdf"), true);
});

test("CSV: οριοθέτηση, escaping και προστασία από formula injection", () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('κείμενο "με" quotes'), '"κείμενο ""με"" quotes"');
  const csv = scheduleCsv([shift]);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.includes("\r\n"), true);
  assert.equal(csv.includes("'=HYPERLINK"), true);
});

test("ICS: escaping, UTF-8 folding και μόνο έγκυρα snapshot shifts", () => {
  assert.equal(icsEscape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  for (const line of icsFold(`SUMMARY:${"Ελληνική βάρδια ".repeat(20)}`).split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const ics = scheduleIcs({ publicationId: "pub-1", version: 2, title: "Πρόγραμμα", shifts: [shift], now: new Date("2026-11-24T10:00:00Z") });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0"));
  assert.ok(ics.includes("UID:shift-1-v2@gelato"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.deepEqual(scheduleShifts({ shifts: [shift, { id: "broken" }] }), [shift]);
});

test("XLSX: πραγματικό OOXML και τα δεδομένα μένουν κείμενο, όχι formulas", async () => {
  const bytes = await scheduleXlsx({ title: "Πρόγραμμα", version: 1, fromAt: new Date(shift.startsAt), toAt: new Date(shift.endsAt), shifts: [shift] });
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString("ascii"), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("Πρόγραμμα");
  assert.ok(sheet);
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("A2").value, shift.employeeName);
  assert.equal(typeof sheet.getCell("A2").value, "string");
});

test("HACCP: μηνιαία όρια Athens και αυστηρό validation", () => {
  const november = monthBounds("2026-11");
  assert.equal(november?.fromAt.toISOString(), "2026-10-31T22:00:00.000Z");
  assert.equal(november?.toAt.toISOString(), "2026-11-30T22:00:00.000Z");
  const july = monthBounds("2026-07");
  assert.equal(july?.fromAt.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(monthBounds("../../2026-11"), null);
});

const quoteDocument: WholesaleQuoteDocumentData = {
  id: "quote-1", storeId: "store-1", warehouseId: "warehouse-1", number: "ΠΡ-2026-000001", status: "ACCEPTED",
  validUntil: new Date("2026-11-30T12:00:00.000Z"), neededAt: new Date("2026-12-02T12:00:00.000Z"), note: "Παγωμένη συμφωνία",
  netCents: 2000, vatCents: 480, totalCents: 2480,
  customerSnapshot: { name: "Πελάτης snapshot", vatNumber: "123456789", countryCode: "GR", address: "Οδός 2", postalCode: "11500", city: "Αθήνα" },
  sentAt: new Date("2026-11-24T09:00:00.000Z"), acceptedAt: new Date("2026-11-24T10:00:00.000Z"),
  rejectedAt: null, rejectionReason: null, expiredAt: null, convertedAt: null, createdAt: new Date("2026-11-23T09:00:00.000Z"),
  org: { name: "Επιχείρηση", legalName: "Επιχείρηση ΑΕ", vatNumber: "999999999", address: null, city: null, postalCode: null, phone: null, labelExtraText: null },
  storeName: "Κατάστημα Κέντρο", warehouseName: "Κεντρική αποθήκη",
  lines: [{ description: "Παγωτό snapshot", unitLabel: "kg", unitScale: 1_000_000, quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24 }],
};

test("PDF wholesale_quote: πλήρες snapshot, scope και πραγματική PDF υπογραφή", async () => {
  const loaded = buildWholesaleQuoteDocument(quoteDocument);
  assert.deepEqual(loaded.scope, { storeId: "store-1", warehouseId: "warehouse-1" });
  assert.equal(loaded.model.entityType, "wholesale_quote");
  assert.equal(loaded.model.title, "Προσφορά χονδρικής ΠΡ-2026-000001");
  const details = loaded.model.sections[0]?.fields ?? [];
  for (const label of ["Αριθμός", "Κατάσταση", "Δημιουργία", "Ισχύς έως", "Επιθυμητή παράδοση", "Κατάστημα", "Αποθήκη", "Σήμανση ως απεσταλμένη", "Αποδοχή"]) {
    assert.ok(details.some((field) => field.label === label && field.value !== "—"), label);
  }
  assert.equal(loaded.model.sections[1]?.fields?.[0]?.value, "Πελάτης snapshot");
  const row = loaded.model.sections[2]?.table?.rows[0];
  assert.deepEqual(row?.slice(0, 4), ["Παγωτό snapshot", "2 kg", "10,00 € / kg", "24%"]);
  assert.equal(row?.[4]?.includes("20,00"), true);
  assert.equal(row?.[5]?.includes("4,80"), true);
  assert.equal(row?.[6]?.includes("24,80"), true);
  const bytes = await createDocumentPdf(loaded.model);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
  assert.equal(Buffer.from(bytes.subarray(-7)).includes("%%EOF"), true);
  assert.ok(bytes.byteLength > 2_000);
});

function replaceMethod(t: TestContext, object: object, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { value, configurable: true, writable: true });
  t.after(() => previous ? Object.defineProperty(object, key, previous) : Reflect.deleteProperty(object, key));
}

test("loader wholesale_quote: org filter και κανένα store/warehouse read για ξένο tenant", async (t) => {
  const lookups: unknown[] = [];
  let relatedReads = 0;
  replaceMethod(t, db.wholesaleQuote, "findFirst", async (query: { where: { id: string; orgId: string } }) => {
    lookups.push(query.where);
    return query.where.orgId === "org-own" ? quoteDocument : null;
  });
  replaceMethod(t, db.store, "findFirst", async () => { relatedReads += 1; return { name: quoteDocument.storeName }; });
  replaceMethod(t, db.warehouse, "findFirst", async () => { relatedReads += 1; return { name: quoteDocument.warehouseName }; });
  const ctx: StockContext = { orgId: "org-own", membershipId: "member-1", userId: "user-1", userName: "Tester", permissions: ["wholesale.read"], storeIds: [], warehouseIds: [], can: () => true };
  const own = await loadDocument(ctx, "wholesale_quote", "quote-1");
  const foreign = await loadDocument({ ...ctx, orgId: "org-foreign" }, "wholesale_quote", "quote-1");
  assert.ok(own);
  assert.equal(foreign, null);
  assert.deepEqual(lookups, [{ id: "quote-1", orgId: "org-own" }, { id: "quote-1", orgId: "org-foreign" }]);
  assert.equal(relatedReads, 2);
});
