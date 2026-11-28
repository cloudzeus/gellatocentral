// Έλεγχος σκαναρισμένων παραστατικών προμηθευτών με ό,τι δήλωσε ο προμηθευτής στο myDATA. Μόνο ανάγνωση (RequestDocs):
// οι δικές μας διαβιβάσεις γίνονται από τη Viva. Mockup: docs/analysis/mockups/mydata-check.html.
// Με MARK φέρνει ακριβώς εκείνο το παραστατικό· χωρίς MARK ψάχνει με ΑΦΜ εκδότη και αριθμό γύρω από την ημερομηνία.
// Ό,τι δεν βρέθηκε ξαναελέγχεται κάθε βράδυ για 7 ημέρες (cron /api/cron/mydata). Διαφορά χωρίς απόφαση μπλοκάρει την πληρωμή.
import { db } from "./db";
import { HAS_KEYS, issuers } from "./mydata-keys";
import type { Prisma } from "./generated/prisma/client";
import { fetchByMark, fetchMyIncome, MydataError } from "./mydata-income";
import { diffWithMydata, parseMyIncomeXml, sameNumber, type MydataDiff, type MyIncomeDoc, type ScannedHeader } from "./mydata-parse";
import { calculatePurchaseDocument } from "./purchase-document";
import { runTask } from "./tasks";

export type CheckStatus = "MATCH" | "DIFF" | "NOT_FOUND" | "ERROR";
export type MydataFound = { mark: string; supplierVat: string; series: string | null; number: string | null; issuedAt: string | null; type: string | null; netCents: number | null; vatCents: number | null; grossCents: number | null };
export type CheckResult = { status: CheckStatus; diff: MydataDiff[]; mydata: MydataFound | null; error: string | null };

const DAY = 86_400_000;
const RECHECK_DAYS = 7;
const WINDOW_DAYS = 5; // χωρίς MARK: ψάχνει ±5 ημέρες γύρω από την ημερομηνία του χαρτιού

type Keys = { userId: string; subKey: string; vat: string };

// shortcut: ψάχνει ως αγοραστή τον ΑΦΜ της επιχείρησης, με το πρώτο ζεύγος κλειδιών του (επιχείρηση ή κατάστημα)·
// όταν οι εκδότες (LegalEntity) αγοράζουν χωριστά, ΑΦΜ αγοραστή ανά παραστατικό
async function orgKeys(orgId: string): Promise<Keys | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { vatNumber: true } });
  const k = (await issuers(orgId)).find((i) => i.vat === org?.vatNumber)?.keys[0];
  return k && org?.vatNumber ? { userId: k.userId, subKey: k.subKey, vat: org.vatNumber } : null;
}

const found = (d: MyIncomeDoc): MydataFound => ({
  mark: d.mark, supplierVat: d.supplierVat, series: d.series, number: d.number, issuedAt: d.issuedAt?.toISOString().slice(0, 10) ?? null, type: d.type,
  netCents: d.netCents, vatCents: d.vatCents, grossCents: d.grossCents,
});

async function search(keys: Keys, h: ScannedHeader): Promise<MyIncomeDoc | null> {
  if (h.mark) return fetchByMark(keys.userId, keys.subKey, keys.vat, h.mark.trim());
  const vat = (h.vatNumber ?? "").replace(/^EL/i, "");
  if (!vat || !h.number) return null;
  const at = h.issuedAt ? new Date(h.issuedAt) : new Date();
  const from = new Date(at.getTime() - WINDOW_DAYS * DAY), to = new Date(Math.min(Date.now(), at.getTime() + WINDOW_DAYS * DAY));
  const docs = parseMyIncomeXml(await fetchMyIncome(keys.userId, keys.subKey, keys.vat, from, to));
  return docs.find((d) => d.supplierVat === vat && sameNumber(h.number!, d)) ?? null;
}

/** Έλεγχος χωρίς αποθήκευση (π.χ. μόλις διαβαστεί η φωτογραφία). null: η επιχείρηση δεν έχει κλειδιά myDATA ή δεν υπάρχει MARK ούτε ΑΦΜ+αριθμός. */
export async function liveCheck(orgId: string, h: ScannedHeader): Promise<CheckResult | null> {
  if (!h.mark && !(h.vatNumber && h.number)) return null;
  const keys = await orgKeys(orgId);
  if (!keys) return null;
  try {
    const doc = await search(keys, h);
    if (!doc) return { status: "NOT_FOUND", diff: [], mydata: null, error: null };
    const diff = diffWithMydata(h, doc);
    return { status: diff.length ? "DIFF" : "MATCH", diff, mydata: found(doc), error: null };
  } catch (e) {
    if (e instanceof MydataError) return { status: "ERROR", diff: [], mydata: null, error: e.message };
    throw e;
  }
}

/** Τα στοιχεία του χαρτιού όπως καταχωρίστηκαν: για παραλαβή από το δελτίο της, για τιμολόγιο από το ίδιο με τα ποσά του. */
async function headerOf(orgId: string, purchaseDocId: string) {
  const doc = await db.purchaseDoc.findFirst({
    where: { id: purchaseDocId, orgId },
    include: { supplier: { select: { vatNumber: true } }, lines: true },
  });
  if (!doc || doc.source === "mydata" || doc.status === "CANCELLED") return null; // ήρθε από το ίδιο το myDATA: δεν ελέγχεται
  const receipt = doc.kind === "RECEIPT" ? await db.purchaseReceipt.findUnique({ where: { purchaseDocId: doc.id }, select: { deliveryNoteNumber: true, deliveryNoteDate: true, deliveryNoteMark: true } }) : null;
  const t = doc.kind === "RECEIPT" ? null : calculatePurchaseDocument(doc.lines, doc);
  const header: ScannedHeader = receipt
    ? { vatNumber: doc.supplier.vatNumber, number: receipt.deliveryNoteNumber, issuedAt: receipt.deliveryNoteDate, mark: receipt.deliveryNoteMark }
    : { vatNumber: doc.supplier.vatNumber, number: doc.number, issuedAt: doc.issuedAt, mark: doc.mydataMark, totals: t && doc.lines.length ? { netCents: t.totalNetCents, vatCents: t.totalVatCents, grossCents: t.totalNetCents + t.totalVatCents } : null };
  return { doc, header };
}

/** Ελέγχει και αποθηκεύει. Δεν πετά ποτέ για λάθη της ΑΑΔΕ: γράφονται ως ERROR και ξαναδοκιμάζονται το βράδυ. */
export async function checkPurchaseDoc(orgId: string, purchaseDocId: string): Promise<CheckResult | null> {
  const loaded = await headerOf(orgId, purchaseDocId);
  if (!loaded) return null;
  const r = await liveCheck(orgId, loaded.header);
  if (!r) return null;
  const prev = await db.mydataCheck.findUnique({ where: { purchaseDocId } });
  const recheck = r.status === "NOT_FOUND" || r.status === "ERROR";
  // η απόφαση «το χαρτί είναι σωστό» μένει όσο υπάρχει διαφορά· αν πια συμφωνούν, δεν χρειάζεται
  const keep = r.status === "DIFF" && prev?.resolution ? { resolution: prev.resolution, resolvedByName: prev.resolvedByName, resolvedAt: prev.resolvedAt } : { resolution: null, resolvedByName: null, resolvedAt: null };
  const data = {
    status: r.status, diff: r.diff as unknown as Prisma.InputJsonValue, mydata: (r.mydata ?? undefined) as Prisma.InputJsonValue | undefined, error: r.error, checkedAt: new Date(),
    recheckUntil: recheck ? prev?.recheckUntil ?? new Date(loaded.doc.createdAt.getTime() + RECHECK_DAYS * DAY) : null, ...keep,
  };
  await db.mydataCheck.upsert({ where: { purchaseDocId }, create: { orgId, purchaseDocId, ...data }, update: data });
  return r;
}

/** Ο έλεγχος δεν επιτρέπεται να χαλάσει την καταχώριση: λάθος βάσης ή δικτύου γράφεται στο log. */
export async function checkQuietly(orgId: string, purchaseDocId: string) {
  try { return await checkPurchaseDoc(orgId, purchaseDocId); } catch (e) { console.error("mydata check", e); return null; }
}

/**
 * Απόφαση για διαφορά. AADE: τα στοιχεία κεφαλίδας (αριθμός, ημερομηνία, MARK) παίρνουν τις τιμές της ΑΑΔΕ και ξαναελέγχεται·
 * αν μείνουν διαφορές στα ποσά, οι γραμμές θέλουν διόρθωση και η διαφορά μένει ανοιχτή. PAPER: το χαρτί είναι σωστό, κρατιέται σημείωση.
 */
export async function resolveCheck(orgId: string, purchaseDocId: string, choice: "AADE" | "PAPER", userName: string): Promise<{ open: MydataDiff[] }> {
  const check = await db.mydataCheck.findFirst({ where: { orgId, purchaseDocId } });
  if (!check || check.status !== "DIFF") return { open: [] };
  if (choice === "PAPER") {
    await db.mydataCheck.update({ where: { id: check.id }, data: { resolution: "PAPER", resolvedByName: userName, resolvedAt: new Date() } });
    return { open: [] };
  }
  const m = check.mydata as MydataFound | null;
  if (!m) return { open: [] };
  const number = [m.series, m.number].filter(Boolean).join("-") || null;
  const issuedAt = m.issuedAt ? new Date(`${m.issuedAt}T12:00:00Z`) : null;
  const doc = await db.purchaseDoc.findFirstOrThrow({ where: { id: purchaseDocId, orgId }, select: { kind: true, status: true } });
  if (doc.kind === "RECEIPT") await db.purchaseReceipt.update({ where: { purchaseDocId }, data: { deliveryNoteNumber: number, deliveryNoteDate: issuedAt, deliveryNoteMark: m.mark } });
  else {
    // το MARK είναι μοναδικό ανά επιχείρηση: αν το έχει ήδη άλλο παραστατικό (π.χ. λήψη από myDATA), δεν αντιγράφεται
    const taken = await db.purchaseDoc.findFirst({ where: { orgId, mydataMark: m.mark, NOT: { id: purchaseDocId } }, select: { id: true } });
    await db.purchaseDoc.update({ where: { id: purchaseDocId }, data: { number, issuedAt, ...(taken ? {} : { mydataMark: m.mark }) } });
  }
  const r = await checkPurchaseDoc(orgId, purchaseDocId);
  const open = r?.status === "DIFF" ? r.diff : [];
  if (open.length) return { open };
  await db.mydataCheck.updateMany({ where: { purchaseDocId }, data: { resolution: "AADE", resolvedByName: userName, resolvedAt: new Date() } });
  return { open: [] };
}

/**
 * Βραδινός έλεγχος: ό,τι δεν βρέθηκε ή απέτυχε (ως 7 ημέρες) και ό,τι καταχωρίστηκε χωρίς έλεγχο τις τελευταίες 7 ημέρες.
 * Οι νέες διαφορές γράφονται στις «Εργασίες» της επιχείρησης, με σύνδεσμο στη λίστα αγορών.
 */
export async function recheckDue(now = new Date()) {
  const since = new Date(now.getTime() - RECHECK_DAYS * DAY);
  const docs = await db.purchaseDoc.findMany({
    where: {
      source: { not: "mydata" }, status: { not: "CANCELLED" }, createdAt: { gte: since },
      org: HAS_KEYS,
      OR: [{ mydataCheck: null }, { mydataCheck: { status: { in: ["NOT_FOUND", "ERROR"] }, recheckUntil: { gt: now } } }],
    },
    select: { id: true, orgId: true, number: true, supplier: { select: { name: true } } },
    take: 500,
  });
  const byOrg = new Map<string, typeof docs>();
  for (const d of docs) byOrg.set(d.orgId, [...(byOrg.get(d.orgId) ?? []), d]);
  let checked = 0, diffs = 0;
  for (const [orgId, list] of byOrg) {
    const found: { id: string; label: string; reason: string }[] = [];
    for (const d of list) {
      const r = await checkQuietly(orgId, d.id);
      if (!r) continue;
      checked++;
      if (r.status === "DIFF") found.push({ id: d.id, label: `${d.supplier.name} · ${d.number ?? "χωρίς αριθμό"}`, reason: r.diff.map((x) => `${x.label}: ${x.scanned} στο χαρτί, ${x.mydata} στο myDATA`).join(" · ") });
    }
    diffs += found.length;
    if (!found.length) continue;
    await runTask({ orgId, userId: "system", userName: "Βραδινός έλεγχος" }, { kind: "purchases.mydata-check", title: `Διαφορές με το myDATA σε ${found.length} παραστατικά`, permission: "purchases.read", total: found.length }, async (task) => {
      for (const f of found) await task.fail(f);
      task.result("/purchases?mydata=DIFF");
    }).catch(() => undefined);
  }
  return { checked, diffs };
}
