// Αποδείξεις του ταμείου απέναντι στην ΑΑΔΕ. Η ΑΑΔΕ δεν δίνει τις αποδείξεις της Viva μία-μία (το RequestTransmittedDocs
// γυρίζει μόνο ό,τι διαβίβασε ο ίδιος χρήστης), δίνει όμως πλήθος και σύνολο ανά ημέρα και τύπο (RequestMyIncome).
// Συγκρίνουμε αυτά με τις δικές μας αποδείξεις με MARK. Μόνο ανάγνωση· οι διαβιβάσεις μένουν στη Viva.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Β. Τρέχει κάθε βράδυ (cron /api/cron/mydata) και με «Ξαναέλεγξε τώρα».
import { db } from "./db";
import { fetchBookIncome, MydataError } from "./mydata-income";
import { parseBookInfo } from "./mydata-parse";
import { athensDay, checkDays, dayStatus, RECEIPT_TYPES } from "./mydata-receipts-match";
import { runTask } from "./tasks";

const DAY = 86_400_000;
/** Χωρίς MARK τόση ώρα μετά την έκδοση = κάτι κόλλησε (η Viva συνήθως απαντά σε λεπτά). */
const UNMARKED_AFTER_MS = 60 * 60_000;

type Issuer = { vat: string; name: string; userId: string | null; subKey: string | null };

/** Οι εκδότες της επιχείρησης: η ίδια και τα νομικά πρόσωπα των καταστημάτων. */
export async function issuers(orgId: string): Promise<Issuer[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { vatNumber: true, name: true, legalName: true, aadeUserId: true, aadeSubKey: true, legalEntities: { where: { active: true }, select: { vatNumber: true, name: true, aadeUserId: true, aadeSubKey: true } } } });
  const list: Issuer[] = org.vatNumber ? [{ vat: org.vatNumber, name: org.legalName || org.name, userId: org.aadeUserId, subKey: org.aadeSubKey }] : [];
  for (const e of org.legalEntities) if (!list.some((i) => i.vat === e.vatNumber)) list.push({ vat: e.vatNumber, name: e.name, userId: e.aadeUserId, subKey: e.aadeSubKey });
  return list;
}

const RECEIPT_SELECT = {
  id: true, docType: true, mark: true, status: true, totalCents: true, createdAt: true, aa: true,
  sale: { select: { id: true, issuedAt: true, totalCents: true, series: true, aa: true, status: true, store: { select: { name: true, legalEntity: { select: { vatNumber: true } } } }, device: { select: { name: true } } } },
  series: { select: { code: true, store: { select: { name: true, legalEntity: { select: { vatNumber: true } } } } } },
} as const;

/** Οι αποδείξεις που πράγματι εκδόθηκαν (όχι δοκιμαστικές, όχι αποτυχημένες πληρωμές) από `since` και μετά. */
async function receipts(orgId: string, since: Date) {
  const rows = await db.fiscalDocument.findMany({
    where: { orgId, docType: { in: [...RECEIPT_TYPES] }, status: { in: ["SIGNED", "PENDING"] }, createdAt: { gte: since } },
    select: RECEIPT_SELECT,
  });
  // απόδειξη πώλησης μετρά μόνο αν η πώληση ολοκληρώθηκε (PENDING = η πληρωμή στο τερματικό δεν έχει τελειώσει)
  return rows.filter((r) => !r.sale || r.sale.status === "COMPLETED").map((r) => ({
    ...r,
    at: r.sale?.issuedAt ?? r.createdAt,
    cents: Math.abs(r.totalCents ?? r.sale?.totalCents ?? 0),
    issuerVat: r.sale?.store.legalEntity?.vatNumber ?? r.series?.store?.legalEntity?.vatNumber ?? null,
    store: r.sale?.store.name ?? r.series?.store?.name ?? null,
    label: r.sale ? `${r.sale.series ?? ""}-${r.sale.aa ?? ""}` : `${r.series?.code ?? ""}-${r.aa ?? ""}`,
  }));
}

/** Συγκρίνει τις ημέρες του παραθύρου για κάθε εκδότη με κλειδιά. Επιστρέφει πόσες διαφέρουν και ποιοι εκδότες δεν ελέγχθηκαν. */
export async function checkReceipts(orgId: string, now = new Date()) {
  const days = checkDays(now);
  const from = new Date(`${days[0]}T00:00:00Z`), to = new Date(`${days.at(-1)}T00:00:00Z`);
  const [list, ours, org] = await Promise.all([
    issuers(orgId),
    receipts(orgId, new Date(from.getTime() - DAY)),
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { vatNumber: true } }),
  ]);
  const withKeys = list.filter((i) => i.userId && i.subKey);
  if (!withKeys.length) throw new MydataError("Δεν έχουν οριστεί κλειδιά myDATA — τα ορίζει η πλατφόρμα στην καρτέλα της επιχείρησης");
  const existing = new Map((await db.mydataDayCheck.findMany({ where: { orgId, day: { gte: from, lte: to } } })).map((r) => [`${r.issuerVat}|${athensDay(r.day)}|${r.invType}`, r]));
  const failed: string[] = [];
  let diff = 0;
  for (const issuer of withKeys) {
    let aade;
    try { aade = parseBookInfo(await fetchBookIncome(issuer.userId!, issuer.subKey!, issuer.vat, from, to)).filter((b) => (RECEIPT_TYPES as readonly string[]).includes(b.invType)); }
    catch (e) { failed.push(`${issuer.name}: ${e instanceof Error ? e.message : "σφάλμα"}`); continue; }
    const mine = ours.filter((r) => r.mark && (r.issuerVat ?? org.vatNumber) === issuer.vat);
    for (const day of days) {
      const types = new Set([...mine.filter((r) => athensDay(r.at) === day).map((r) => r.docType), ...aade.filter((b) => b.day === day).map((b) => b.invType)]);
      for (const invType of types) {
        const rows = mine.filter((r) => r.docType === invType && athensDay(r.at) === day);
        const side = { count: rows.length, cents: rows.reduce((s, r) => s + r.cents, 0) };
        const a = aade.find((b) => b.day === day && b.invType === invType);
        const prev = existing.get(`${issuer.vat}|${day}|${invType}`);
        const st = dayStatus(side, a ? { count: a.count, cents: a.grossCents } : null, prev?.firstDiffAt ?? null, now);
        if (st.status === "DIFF") diff++;
        const data = { issuerName: issuer.name, oursCount: side.count, oursCents: side.cents, aadeCount: a?.count ?? null, aadeCents: a?.grossCents ?? null, status: st.status, firstDiffAt: st.firstDiffAt, checkedAt: now, ...(st.status === "MATCH" ? { notifiedAt: null } : {}) };
        await db.mydataDayCheck.upsert({ where: { orgId_issuerVat_day_invType: { orgId, issuerVat: issuer.vat, day: new Date(`${day}T00:00:00Z`), invType } }, create: { orgId, issuerVat: issuer.vat, day: new Date(`${day}T00:00:00Z`), invType, ...data }, update: data });
      }
    }
  }
  // εκτός παραθύρου δεν ξαναελέγχονται: κρατάμε 3 μήνες ιστορικό
  await db.mydataDayCheck.deleteMany({ where: { orgId, day: { lt: new Date(now.getTime() - 92 * DAY) } } });
  if (failed.length === withKeys.length) throw new MydataError(failed.join(" · "));
  return { diff, failed, skipped: list.filter((i) => !i.userId || !i.subKey).map((i) => i.name) };
}

/** Αποδείξεις που εκδόθηκαν αλλά δεν πήραν MARK (η Viva τις ξαναστέλνει μόνη της· εδώ φαίνονται όσες κόλλησαν). */
export async function unmarkedReceipts(orgId: string, now = new Date()) {
  const rows = await receipts(orgId, new Date(now.getTime() - 31 * DAY));
  return rows.filter((r) => !r.mark && now.getTime() - r.at.getTime() > UNMARKED_AFTER_MS).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Βραδινός γύρος: κάθε επιχείρηση με κλειδιά (δική της ή εκδότη). Οι νέες κόκκινες ημέρες μπαίνουν μία φορά στις «Εργασίες». */
export async function checkAllReceipts(now = new Date()) {
  const orgs = await db.organization.findMany({ where: { OR: [{ aadeUserId: { not: null } }, { legalEntities: { some: { aadeUserId: { not: null } } } }] }, select: { id: true } });
  let diff = 0, failed = 0;
  for (const { id: orgId } of orgs) {
    try { diff += (await checkReceipts(orgId, now)).diff; } catch (e) { failed++; console.error("mydata receipts", orgId, e); continue; }
    const fresh = await db.mydataDayCheck.findMany({ where: { orgId, status: "DIFF", notifiedAt: null }, orderBy: { day: "asc" } });
    if (!fresh.length) continue;
    await runTask({ orgId, userId: "system", userName: "Βραδινός έλεγχος" }, { kind: "transmissions.aade-days", title: `${fresh.length} ${fresh.length === 1 ? "ημέρα" : "ημέρες"} με αποδείξεις που δεν συμφωνούν με την ΑΑΔΕ`, permission: "invoices.read", total: fresh.length }, async (task) => {
      for (const d of fresh) await task.fail({ id: d.id, label: `${athensDay(d.day)} · ${d.issuerName} · ${d.invType}`, reason: `Δικές μας ${d.oursCount}, στην ΑΑΔΕ ${d.aadeCount ?? 0}` });
      task.result("/transmissions?view=aade");
    }).catch(() => undefined);
    await db.mydataDayCheck.updateMany({ where: { id: { in: fresh.map((d) => d.id) } }, data: { notifiedAt: now } });
  }
  return { orgs: orgs.length, diff, failed };
}
