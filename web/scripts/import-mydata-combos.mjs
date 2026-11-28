// Επιτρεπτοί συνδυασμοί χαρακτηρισμών myDATA (ΑΑΔΕ) από το επίσημο xlsx σε JSON μέσα στον κώδικα.
// Χρήση: node scripts/import-mydata-combos.mjs <xlsx> <έκδοση>
// π.χ. node scripts/import-mydata-combos.mjs ../audit-reports/sources/mydata-v2.0.2/syndiasmoi_xaraktirismwn_v2.0.2.xlsx 2.0.2
// Νέα έκδοση της ΑΑΔΕ = ξανατρέχεις το script, χωρίς αλλαγή κώδικα.
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const [file, version] = process.argv.slice(2);
if (!file || !version) throw new Error("Χρήση: node scripts/import-mydata-combos.mjs <xlsx> <έκδοση>");

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("").trim();
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v).trim();
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const combos = {};
for (const ws of wb.worksheets) {
  const docType = ws.name.trim();
  if (!/^\d+\.\d+$/.test(docType)) continue;
  // στη γραμμή 6 οι στήλες «ΕΠΙΤΡΕΠΤΕΣ ΤΙΜΕΣ ΣΤΗΛΗΣ 9» (κατηγορία)· η επόμενη στήλη έχει τους τύπους Ε3· η γραμμή 5 λέει έσοδα ή έξοδα
  const pairs = [];
  ws.getRow(6).eachCell({ includeEmpty: false }, (cell, col) => {
    if (!/ΣΤΗΛΗΣ 9/.test(text(cell.value))) return;
    // το xlsx ανακατεύει λατινικά E/O με ελληνικά Ε/Ο
    const side = /[ΕE]Ξ[ΟO]Δ/.test(text(ws.getRow(5).getCell(col).value)) ? "EXPENSE" : "INCOME";
    pairs.push({ col, side, current: "" });
  });
  for (let r = 7; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (const p of pairs) {
      const cat = text(row.getCell(p.col).value);
      if (/^category\d_\d+$/.test(cat)) p.current = cat;
      else if (cat) p.current = ""; // σημείωση αντί για κατηγορία: σταματά η τρέχουσα ομάδα
      const type = text(row.getCell(p.col + 1).value);
      if (!p.current || !/^E3_\d/.test(type)) continue;
      const bySide = (combos[docType] ??= {})[p.side] ??= {};
      const list = (bySide[p.current] ??= []);
      if (!list.includes(type)) list.push(type);
    }
  }
}
const out = new URL("../lib/mydata-combos.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ version, source: "ΑΑΔΕ, πίνακες συνδυασμών χαρακτηρισμών", combos }, null, 1)}\n`);
console.log(`${Object.keys(combos).length} τύποι παραστατικών → ${out.pathname}`);
