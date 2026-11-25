// Exports δημοσιευμένου snapshot· δεν διαβάζονται ζωντανές/ανέκδοτες βάρδιες ή στοιχεία αμοιβών.
export type ScheduleExportShift = {
  id: string;
  employeeId: string;
  employeeName: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  note: string | null;
  departmentName: string | null;
  storeName: string | null;
};

export function scheduleShifts(snapshot: unknown): ScheduleExportShift[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("shifts" in snapshot) || !Array.isArray(snapshot.shifts)) return [];
  return snapshot.shifts.filter((row): row is ScheduleExportShift => {
    if (!row || typeof row !== "object") return false;
    const value = row as Record<string, unknown>;
    return ["id", "employeeId", "employeeName", "startsAt", "endsAt"].every((key) => typeof value[key] === "string")
      && typeof value.breakMinutes === "number" && Number.isFinite(Date.parse(String(value.startsAt))) && Number.isFinite(Date.parse(String(value.endsAt)));
  });
}

export function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/\u0000/g, "");
  // Το spreadsheet δεν πρέπει να εκτελέσει ως formula κείμενο που καταχώρισε χρήστης.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function scheduleCsv(shifts: ScheduleExportShift[]) {
  const rows = [
    ["Εργαζόμενος", "Έναρξη", "Λήξη", "Διάλειμμα (λεπτά)", "Τμήμα", "Κατάστημα", "Σημείωση"],
    ...shifts.map((shift) => [shift.employeeName, shift.startsAt, shift.endsAt, shift.breakMinutes, shift.departmentName, shift.storeName, shift.note]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function icsEscape(value: unknown) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n?|\n/g, "\\n");
}

export function icsFold(line: string) {
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const next = current + character;
    if (Buffer.byteLength(next, "utf8") > 73 && current) {
      parts.push(current);
      current = ` ${character}`;
    } else current = next;
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

const icsStamp = (value: Date | string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function scheduleIcs(input: { publicationId: string; version: number; title: string; shifts: ScheduleExportShift[]; now?: Date }) {
  const stamp = icsStamp(input.now ?? new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gelato System//Schedule//EL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const shift of input.shifts) {
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(`${shift.id}-v${input.version}@gelato`)}`, `DTSTAMP:${stamp}`, `DTSTART:${icsStamp(shift.startsAt)}`, `DTEND:${icsStamp(shift.endsAt)}`, `SUMMARY:${icsEscape(`${input.title} · ${shift.employeeName}`)}`, `DESCRIPTION:${icsEscape([shift.departmentName, shift.storeName, shift.note].filter(Boolean).join(" · "))}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

export async function scheduleXlsx(input: { title: string; version: number; fromAt: Date; toAt: Date; shifts: ScheduleExportShift[] }) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gelato System";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Πρόγραμμα", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Εργαζόμενος", key: "employee", width: 28 },
    { header: "Έναρξη", key: "start", width: 22 },
    { header: "Λήξη", key: "end", width: 22 },
    { header: "Διάλειμμα (λεπτά)", key: "break", width: 18 },
    { header: "Τμήμα", key: "department", width: 22 },
    { header: "Κατάστημα", key: "store", width: 22 },
    { header: "Σημείωση", key: "note", width: 45 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const shift of input.shifts) sheet.addRow({ employee: shift.employeeName, start: new Date(shift.startsAt), end: new Date(shift.endsAt), break: shift.breakMinutes, department: shift.departmentName ?? "", store: shift.storeName ?? "", note: shift.note ?? "" });
  sheet.getColumn("start").numFmt = "dd/mm/yyyy hh:mm";
  sheet.getColumn("end").numFmt = "dd/mm/yyyy hh:mm";
  sheet.autoFilter = { from: "A1", to: "G1" };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
