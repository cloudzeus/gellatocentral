// Λογική των οθονών του σερβιτόρου (WaiterScreens.tsx), χωρίς React: τι «σε περιμένει», σε ποιο σημείο είναι κάθε τραπέζι,
// τι χρωστάει κάθε θέση. Mockup: docs/analysis/mockups/device-roles-phone-tablet.html, ενότητα 2α.
import type { Bill, BillLine, BillPick, BillSummary, DiningTable, Stage } from "./api";
import type { Reservation } from "./reservations";

/** Πόσα λεπτά χωρίς κίνηση (αποστολή ή σερβίρισμα) κάνουν ένα τραπέζι να θέλει ματιά. */
export const QUIET_MIN = 20;
/** Κράτηση που έρχεται σε τόσα λεπτά: ετοίμασε το τραπέζι. */
export const SOON_MIN = 30;

export const STAGE_TEXT: Record<Stage, string> = { empty: "Άνοιξε· τίποτα ακόμα", ordered: "Παρήγγειλαν", eating: "Τρώνε", asked: "Λογαριασμός" };

export const minutesSince = (iso: string | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)) : 0);

/** Λεπτά σε κείμενο που διαβάζεται: 25′, 2 ώ 05′, 3 μέρες. */
export const durText = (m: number) => (m < 60 ? `${m}′` : m < 1440 ? `${Math.floor(m / 60)} ώ ${String(m % 60).padStart(2, "0")}′` : `${Math.floor(m / 1440)} ${m < 2880 ? "μέρα" : "μέρες"}`);

export type Urgent = { kind: "ready" | "asked" | "held" | "quiet" | "reservation"; key: string; billId?: string; tableId?: string; title: string; sub: string; since?: number };

/**
 * «Σε περιμένουν», με τη σειρά που επείγουν: λογαριασμός που ζητήθηκε, κράτηση που έρχεται, γλυκό που περιμένει ενώ
 * τρώνε, τραπέζι ήσυχο πάνω από QUIET_MIN. mine: μόνο τα δικά μου (αλλιώς όλα).
 */
export function urgentList(bills: BillSummary[], tables: DiningTable[], res: Reservation[], now: Date, euro: (c: number) => string): Urgent[] {
  const name = (b: BillSummary) => { const t = tables.find((x) => x.id === b.tableId); return t ? `Τ${t.name}` : b.label ?? "Λογαριασμός"; };
  const open = new Set(bills.map((b) => b.tableId).filter(Boolean));
  const out: Urgent[] = [];
  // πρώτα ό,τι κρυώνει στο πάσο: η κουζίνα πάτησε «Έτοιμο»
  for (const b of bills) if (b.readyIds?.length) out.push({ kind: "ready", key: `k${b.id}`, billId: b.id, tableId: b.tableId ?? undefined, title: `${name(b)} · Έτοιμο στην κουζίνα`, sub: `${b.readyIds.length} ${b.readyIds.length === 1 ? "είδος" : "είδη"}`, since: minutesSince(b.readySince ?? undefined, now) });
  for (const b of bills) if (b.billAskedAt) out.push({ kind: "asked", key: `a${b.id}`, billId: b.id, tableId: b.tableId ?? undefined, title: `${name(b)} · Λογαριασμός`, sub: `${euro(b.dueCents - b.heldCents)}${b.billAskedCash ? " · μετρητά στο ταμείο" : ""}`, since: minutesSince(b.billAskedAt, now) });
  for (const r of res) {
    if (r.status !== "BOOKED" || !r.tableId || open.has(r.tableId)) continue;
    const mins = Math.round((new Date(r.startsAt).getTime() - now.getTime()) / 60000);
    if (mins > SOON_MIN || mins < -30) continue;
    const t = tables.find((x) => x.id === r.tableId);
    out.push({ kind: "reservation", key: `r${r.id}`, tableId: r.tableId, title: `Τ${t?.name ?? "?"} · Κράτηση`, sub: `${r.guests} άτομα · ${mins >= 0 ? `σε ${durText(mins)}` : `αργούν ${durText(-mins)}`}` });
  }
  for (const b of bills) {
    if (b.billAskedAt) continue;
    if (b.heldItems && b.stage === "eating") out.push({ kind: "held", key: `h${b.id}`, billId: b.id, tableId: b.tableId ?? undefined, title: `${name(b)} · Περιμένει να βγει`, sub: `${b.heldItems} ${b.heldItems === 1 ? "είδος" : "είδη"} στο «Μετά»· έφαγαν` });
    else if (b.stage !== "empty" && minutesSince(b.lastAt, now) >= QUIET_MIN) out.push({ kind: "quiet", key: `q${b.id}`, billId: b.id, tableId: b.tableId ?? undefined, title: `${name(b)} · ${durText(minutesSince(b.lastAt, now))} χωρίς κίνηση`, sub: "Πέρνα να δεις αν θέλουν κάτι" });
  }
  return out;
}

/** Θέσεις του τραπεζιού για την παραγγελία: όσα άτομα δηλώθηκαν, αλλιώς οι θέσεις του τραπεζιού, και όσες έχουν ήδη γραμμές. */
export function seatsOf(bill: Pick<Bill, "guests" | "lines"> | undefined, tableSeats?: number) {
  const used = Math.max(0, ...(bill?.lines ?? []).map((l) => l.seat ?? 0));
  return Math.max(used, bill?.guests ?? tableSeats ?? 0);
}

/** Τι μένει να πληρωθεί ανά θέση· η θέση 0 = χωρίς θέση («Κοινά»). */
export function seatDue(lines: BillLine[]) {
  const m = new Map<number, number>();
  for (const l of lines) if (l.remaining > 0) m.set(l.seat ?? 0, (m.get(l.seat ?? 0) ?? 0) + l.remaining * l.unitPriceCents);
  return m;
}

/** Ό,τι μένει απλήρωτο στη θέση (0 = κοινά), ως επιλογή για το «Ανά είδη» του server. */
export const seatPick = (lines: BillLine[], seat: number): BillPick[] =>
  lines.filter((l) => l.remaining > 0 && (l.seat ?? 0) === seat).map((l) => ({ lineId: l.id, quantity: l.remaining }));

/** Κατάσταση γραμμής για τη λίστα: «Μετά», «σερβιρίστηκε», «στάλθηκε», «ακυρώθηκε». */
export function lineState(l: BillLine, held: boolean): "held" | "served" | "sent" | "void" {
  if (l.voidedAt) return "void";
  if (held) return "held";
  return l.servedAt ? "served" : "sent";
}
