import { publicSchedule } from "@/lib/staff-db";

const stamp = (value: Date | string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const schedule = await publicSchedule(token);
  const shifts = schedule.publications.flatMap((publication) => publication.shifts);
  const unique = [...new Map(shifts.map((shift) => [shift.id, shift])).values()];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gelato System//Schedule//EL", "CALSCALE:GREGORIAN", ...unique.flatMap((shift) => ["BEGIN:VEVENT", `UID:${shift.id}@gelato`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(shift.startsAt)}`, `DTEND:${stamp(shift.endsAt)}`, `SUMMARY:${escape(`Βάρδια · ${schedule.employee.name}`)}`, `DESCRIPTION:${escape([shift.departmentName, shift.storeName, shift.note].filter(Boolean).join(" · "))}`, "END:VEVENT"]), "END:VCALENDAR"];
  return new Response(`${lines.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=schedule.ics", "Cache-Control": "private, no-store" } });
}
