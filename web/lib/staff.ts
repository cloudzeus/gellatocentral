// Καθαροί υπολογισμοί προσωπικού· οι αμοιβές καλούνται μόνο από server κώδικα με staff.pay.
export function workedMinutes(startsAt: Date, endsAt: Date, breakMinutes = 0) {
  if (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440) throw new Error("Άκυρη διάρκεια διαλείμματος");
  const total = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  if (total <= 0 || total > 7 * 1440) throw new Error("Η βάρδια πρέπει να έχει θετική διάρκεια έως 7 ημέρες");
  if (breakMinutes >= total) throw new Error("Το διάλειμμα υπερβαίνει τη βάρδια");
  return total - breakMinutes;
}

export function hourlyCostCents(minutes: number, hourlyRateCents: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || !Number.isSafeInteger(hourlyRateCents) || hourlyRateCents < 0) throw new Error("Άκυρα δεδομένα αμοιβής");
  return Math.round(minutes * hourlyRateCents / 60);
}

export function intervalsOverlap(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export type PublicScheduleShift = { id: string; employeeId: string; startsAt: string; endsAt: string; breakMinutes: number; note: string | null; departmentName: string | null; storeName: string | null };
export function shiftsForEmployee(snapshot: unknown, employeeId: string): PublicScheduleShift[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("shifts" in snapshot) || !Array.isArray(snapshot.shifts)) return [];
  return snapshot.shifts.filter((row): row is PublicScheduleShift => Boolean(row && typeof row === "object" && "employeeId" in row && row.employeeId === employeeId));
}

/** Μόνο προσθήκη/αφαίρεση/πραγματική αλλαγή βάρδιας δημιουργεί προετοιμασία ειδοποίησης. */
export function affectedScheduleEmployeeIds(previous: unknown, next: unknown) {
  const byEmployee = (snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("shifts" in snapshot) || !Array.isArray(snapshot.shifts)) return new Map<string, string>();
    const result = new Map<string, string[]>();
    for (const row of snapshot.shifts) {
      if (!row || typeof row !== "object" || !("employeeId" in row) || typeof row.employeeId !== "string") continue;
      result.set(row.employeeId, [...(result.get(row.employeeId) ?? []), JSON.stringify(row)]);
    }
    return new Map([...result].map(([employeeId, shifts]) => [employeeId, shifts.sort().join("|")]));
  };
  const before = byEmployee(previous), after = byEmployee(next);
  return [...new Set([...before.keys(), ...after.keys()])].filter((employeeId) => before.get(employeeId) !== after.get(employeeId)).sort();
}
