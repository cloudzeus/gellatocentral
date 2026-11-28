// Αποδείξεις του ταμείου απέναντι στην ΑΑΔΕ, μία-μία με το MARK. Το RequestTransmittedDocs του εκδότη γυρίζει και τις
// αποδείξεις που διαβίβασε η Viva (το RequestMyIncome δεν έχει καθόλου 11.x). Μόνο ανάγνωση· οι διαβιβάσεις μένουν στη Viva.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Β. Τρέχει κάθε βράδυ (cron /api/cron/mydata) και με «Ξαναέλεγξε τώρα».
import { db } from "./db";
import { Prisma } from "./generated/prisma/client";
import { fetchTransmitted, MydataError } from "./mydata-income";
import { parseMyIncomeXml, type MyIncomeDoc } from "./mydata-parse";
import { athensDay, checkDays, matchReceipts, RECEIPT_TYPES, type Gap, type Receipt } from "./mydata-receipts-match";
import { runTask } from "./tasks";

const DAY = 86_400_000;
/** Χωρίς MARK τόση ώρα μετά την έκδοση = κάτι κόλλησε (η Viva συνήθως απαντά σε λεπτά). */
const UNMARKED_AFTER_MS = 60 * 60_000;

type Keys = { userId: string; subKey: string };
type Issuer = { vat: string; name: string; keys: Keys[] };

/**
 * Οι εκδότες της επιχείρησης (η ίδια και τα νομικά πρόσωπα) με όλα τα κλειδιά myDATA του ΑΦΜ τους: του εκδότη και όσων
 * καταστημάτων έχουν δικό τους χρήστη. Ένας ΑΦΜ μπορεί να έχει χρήστη ανά κατάστημα.
 */
export async function issuers(orgId: string): Promise<Issuer[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: {
    vatNumber: true, name: true, legalName: true, aadeUserId: true, aadeSubKey: true,
    legalEntities: { where: { active: true }, select: { id: true, vatNumber: true, name: true, aadeUserId: true, aadeSubKey: true } },
    stores: { where: { active: true, aadeUserId: { not: null }, aadeSubKey: { not: null } }, select: { legalEntityId: true, aadeUserId: true, aadeSubKey: true } },
  } });
  const keysOf = (userId: string | null, subKey: string | null): Keys[] => (userId && subKey ? [{ userId, subKey }] : []);
  const storeKeys = (entityId: string | null) => org.stores.filter((s) => s.legalEntityId === entityId).flatMap((s) => keysOf(s.aadeUserId, s.aadeSubKey));
  const list: Issuer[] = org.vatNumber ? [{ vat: org.vatNumber, name: org.legalName || org.name, keys: [...keysOf(org.aadeUserId, org.aadeSubKey), ...storeKeys(null)] }] : [];
  for (const e of org.legalEntities) {
    const keys = [...keysOf(e.aadeUserId, e.aadeSubKey), ...storeKeys(e.id)];
    const same = list.find((i) => i.vat === e.vatNumber);
    if (same) same.keys.push(...keys); else list.push({ vat: e.vatNumber, name: e.name, keys });
  }
  // ίδιος χρήστης σε πολλά καταστήματα = μία κλήση
  for (const i of list) i.keys = i.keys.filter((k, n) => i.keys.findIndex((x) => x.userId === k.userId && x.subKey === k.subKey) === n);
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

const isReceipt = (t: string | null): t is string => (RECEIPT_TYPES as readonly string[]).includes(t ?? "");

/** Αντιστοιχίζει τις αποδείξεις του παραθύρου για κάθε εκδότη με κλειδιά. Επιστρέφει πόσες ημέρες διαφέρουν και ποιοι εκδότες δεν ελέγχθηκαν. */
export async function checkReceipts(orgId: string, now = new Date()) {
  const days = checkDays(now);
  const window = new Set(days);
  // μία μέρα περιθώριο και στις δύο πλευρές: γύρω στα μεσάνυχτα η ΑΑΔΕ μπορεί να γράψει άλλη ημερομηνία
  const from = new Date(new Date(`${days[0]}T00:00:00Z`).getTime() - DAY), to = now;
  const [list, ours, org] = await Promise.all([
    issuers(orgId),
    receipts(orgId, from),
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { vatNumber: true } }),
  ]);
  const withKeys = list.filter((i) => i.keys.length);
  if (!withKeys.length) throw new MydataError("Δεν έχουν οριστεί κλειδιά myDATA — τα ορίζει η πλατφόρμα στην καρτέλα της επιχείρησης");
  const existing = new Map((await db.mydataDayCheck.findMany({ where: { orgId, day: { gte: new Date(`${days[0]}T00:00:00Z`) } } })).map((r) => [`${r.issuerVat}|${athensDay(r.day)}|${r.invType}`, r]));
  const failed: string[] = [];
  let diff = 0;
  for (const issuer of withKeys) {
    let aade: Receipt[];
    try {
      // κάθε χρήστης του ΑΦΜ μπορεί να βλέπει μέρος ή όλες τις αποδείξεις: ενώνουμε ανά MARK
      const docs = new Map<string, MyIncomeDoc>();
      for (const k of issuer.keys) for (const d of parseMyIncomeXml(await fetchTransmitted(k.userId, k.subKey, from, to))) docs.set(d.mark, d);
      aade = [...docs.values()]
        .filter((d) => isReceipt(d.type))
        .map((d) => ({ mark: d.mark, day: d.issuedAt ? d.issuedAt.toISOString().slice(0, 10) : "", invType: d.type!, cents: Math.abs(d.grossCents ?? 0), label: [d.series, d.number].filter(Boolean).join("-") }));
    } catch (e) { failed.push(`${issuer.name}: ${e instanceof Error ? e.message : "σφάλμα"}`); continue; }
    const mine: Receipt[] = ours.filter((r) => r.mark && (r.issuerVat ?? org.vatNumber) === issuer.vat)
      .map((r) => ({ mark: r.mark!, day: athensDay(r.at), invType: r.docType, cents: r.cents, label: r.label }));
    const gaps = matchReceipts(mine, aade).filter((g) => window.has(g.day));
    for (const day of days) {
      const types = new Set([...mine, ...aade].filter((r) => r.day === day).map((r) => r.invType));
      for (const invType of types) {
        const at = (rs: Receipt[]) => rs.filter((r) => r.day === day && r.invType === invType);
        const m = at(mine), a = at(aade), g = gaps.filter((x) => x.day === day && x.invType === invType);
        const prev = existing.get(`${issuer.vat}|${day}|${invType}`);
        const status = g.length ? "DIFF" : "MATCH";
        if (g.length) diff++;
        const data = {
          issuerName: issuer.name, oursCount: m.length, oursCents: m.reduce((s, r) => s + r.cents, 0), aadeCount: a.length, aadeCents: a.reduce((s, r) => s + r.cents, 0),
          status, gaps: g.length ? (g as unknown as Prisma.InputJsonValue) : undefined, firstDiffAt: g.length ? prev?.firstDiffAt ?? now : null, checkedAt: now,
          // η ίδια διαφορά δεν ξαναμπαίνει στις «Εργασίες» κάθε βράδυ· νέα διαφορά (άλλο πλήθος) ξαναειδοποιεί
          ...(!g.length || (prev?.gaps as Gap[] | null)?.length !== g.length ? { notifiedAt: null } : {}),
        };
        const key = { orgId, issuerVat: issuer.vat, day: new Date(`${day}T00:00:00Z`), invType };
        await db.mydataDayCheck.upsert({ where: { orgId_issuerVat_day_invType: key }, create: { ...key, ...data }, update: { ...data, gaps: data.gaps ?? Prisma.DbNull } });
      }
    }
  }
  // εκτός παραθύρου δεν ξαναελέγχονται: κρατάμε 3 μήνες ιστορικό
  await db.mydataDayCheck.deleteMany({ where: { orgId, day: { lt: new Date(now.getTime() - 92 * DAY) } } });
  if (failed.length === withKeys.length) throw new MydataError(failed.join(" · "));
  return { diff, failed, skipped: list.filter((i) => !i.keys.length).map((i) => i.name) };
}

/** Αποδείξεις που εκδόθηκαν αλλά δεν πήραν MARK (η Viva τις ξαναστέλνει μόνη της· εδώ φαίνονται όσες κόλλησαν). */
export async function unmarkedReceipts(orgId: string, now = new Date()) {
  const rows = await receipts(orgId, new Date(now.getTime() - 31 * DAY));
  return rows.filter((r) => !r.mark && now.getTime() - r.at.getTime() > UNMARKED_AFTER_MS).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Βραδινός γύρος: κάθε επιχείρηση με κλειδιά (δική της ή εκδότη). Οι νέες κόκκινες ημέρες μπαίνουν μία φορά στις «Εργασίες». */
export async function checkAllReceipts(now = new Date()) {
  const orgs = await db.organization.findMany({ where: { OR: [{ aadeUserId: { not: null } }, { legalEntities: { some: { aadeUserId: { not: null } } } }, { stores: { some: { aadeUserId: { not: null } } } }] }, select: { id: true } });
  let diff = 0, failed = 0;
  for (const { id: orgId } of orgs) {
    try { diff += (await checkReceipts(orgId, now)).diff; } catch (e) { failed++; console.error("mydata receipts", orgId, e); continue; }
    const fresh = await db.mydataDayCheck.findMany({ where: { orgId, status: "DIFF", notifiedAt: null }, orderBy: { day: "asc" } });
    if (!fresh.length) continue;
    await runTask({ orgId, userId: "system", userName: "Βραδινός έλεγχος" }, { kind: "transmissions.aade-days", title: `${fresh.length} ${fresh.length === 1 ? "ημέρα" : "ημέρες"} με αποδείξεις που δεν συμφωνούν με την ΑΑΔΕ`, permission: "invoices.read", total: fresh.length }, async (task) => {
      for (const d of fresh) await task.fail({ id: d.id, label: `${athensDay(d.day)} · ${d.issuerName} · ${d.invType}`, reason: gapSummary((d.gaps as Gap[] | null) ?? []) });
      task.result("/transmissions?view=aade");
    }).catch(() => undefined);
    await db.mydataDayCheck.updateMany({ where: { id: { in: fresh.map((d) => d.id) } }, data: { notifiedAt: now } });
  }
  return { orgs: orgs.length, diff, failed };
}

/** Οι διαφορές μιας ημέρας με λόγια, π.χ. «2 λείπουν από την ΑΑΔΕ · 1 με άλλο ποσό». */
export function gapSummary(gaps: Gap[]) {
  const n = (k: Gap["kind"]) => gaps.filter((g) => g.kind === k).length;
  return [
    n("OURS_ONLY") && `${n("OURS_ONLY")} λείπουν από την ΑΑΔΕ`,
    n("AADE_ONLY") && `${n("AADE_ONLY")} στην ΑΑΔΕ που δεν έχουμε`,
    n("AMOUNT") && `${n("AMOUNT")} με άλλο ποσό`,
  ].filter(Boolean).join(" · ");
}
