// Τιμολόγια που λείπουν από τις αγορές: ό,τι δήλωσαν οι προμηθευτές στο myDATA για εμάς (RequestDocs) και δεν ταιριάζει
// με κανένα παραστατικό μας. Μόνο ανάγνωση από την ΑΑΔΕ· οι διαβιβάσεις μας γίνονται από τη Viva.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Α. Τρέχει κάθε βράδυ (cron /api/cron/mydata) και με «Ξαναέλεγξε τώρα».
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { createFromMydata, fetchMyIncome, importContext, MydataError } from "./mydata-income";
import { parseMyIncomeXml, type MyIncomeDoc } from "./mydata-parse";
import { findOurs, isExpense, OLD_DAYS, syncWindow, type OurDoc } from "./mydata-incoming-match";

export { OLD_DAYS, syncWindow };
import { HAS_KEYS, issuers } from "./mydata-keys";
import type { TaskReporter } from "./task-progress";
import { runTask } from "./tasks";

const DAY = 86_400_000;

async function ourDocs(orgId: string, since: Date): Promise<OurDoc[]> {
  const docs = await db.purchaseDoc.findMany({
    where: { orgId, status: { not: "CANCELLED" }, kind: { in: ["INVOICE", "CREDIT", "RETURN"] }, OR: [{ issuedAt: { gte: new Date(since.getTime() - 60 * DAY) } }, { issuedAt: null }, { mydataMark: { not: null } }] },
    select: { id: true, mydataMark: true, number: true, supplier: { select: { vatNumber: true } }, mydataCheck: { select: { mydata: true } } },
  });
  return docs.map((d) => ({ id: d.id, mydataMark: d.mydataMark, number: d.number, supplierVat: d.supplier.vatNumber?.replace(/^EL/i, "") ?? null, checkedMark: (d.mydataCheck?.mydata as { mark?: string } | null)?.mark ?? null }));
}

/**
 * Φέρνει τα έξοδα του διαστήματος από το myDATA και ενημερώνει τη λίστα: νέα → MISSING ή MATCHED, όσα MISSING βρέθηκαν
 * στο μεταξύ → MATCHED, όσα ακυρώθηκαν στην ΑΑΔΕ → σβήνονται. Επιστρέφει τα πλήθη.
 */
export async function syncIncoming(orgId: string, now = new Date(), task?: TaskReporter & { total?(n: number): Promise<void> }) {
  const list = (await issuers(orgId)).filter((i) => i.keys.length);
  if (!list.length) throw new MydataError("Δεν έχουν οριστεί κλειδιά myDATA — τα ορίζει η πλατφόρμα στην καρτέλα της επιχείρησης ή του καταστήματος");
  const { from, to } = syncWindow(now);
  // ένα βήμα ανά ζεύγος κλειδιών (επιχείρηση, εκδότης ή κατάστημα)· τα ίδια παραστατικά από δύο χρήστες ενώνονται ανά MARK
  const byMark = new Map<string, MyIncomeDoc>();
  const steps = list.reduce((n, i) => n + i.keys.length, 0);
  await task?.total?.(steps);
  let failed = 0;
  for (const issuer of list) for (const k of issuer.keys) {
    const label = `${k.source} · ΑΦΜ ${issuer.vat}`;
    await task?.step(label);
    try {
      const got = parseMyIncomeXml(await fetchMyIncome(k.userId, k.subKey, issuer.vat, from, to)).filter((d) => isExpense(d.type));
      for (const d of got) byMark.set(d.mark, d);
      await task?.ok(1, { label, detail: got.length ? `${got.length} ${got.length === 1 ? "παραστατικό εξόδων" : "παραστατικά εξόδων"} στο myDATA` : "Κανένα παραστατικό εξόδων στο διάστημα" });
    } catch (e) {
      failed++;
      await task?.fail({ label, reason: e instanceof Error ? e.message : "σφάλμα" });
    }
  }
  if (failed === steps) throw new MydataError("Κανένα κλειδί myDATA δεν απάντησε — δες τις «Εργασίες»");
  const docs = [...byMark.values()];
  const ours = await ourDocs(orgId, from);
  const known = new Map((await db.mydataIncoming.findMany({ where: { orgId, mark: { in: docs.map((d) => d.mark) } }, select: { mark: true, status: true } })).map((r) => [r.mark, r.status]));

  let added = 0;
  for (const d of docs) {
    const fields = {
      supplierVat: d.supplierVat, supplierName: d.supplierName, type: d.type, series: d.series, number: d.number, issuedAt: d.issuedAt,
      netCents: d.netCents, vatCents: d.vatCents, grossCents: d.grossCents, doc: d as unknown as Prisma.InputJsonValue, checkedAt: now,
    };
    const status = known.get(d.mark);
    const match = status === undefined || status === "MISSING" ? findOurs(d, ours) : null;
    // το ίδιο παραστατικό μπορεί να το «κλείνει» ήδη άλλη γραμμή (π.χ. διπλή αντιστοίχιση): το purchaseDocId είναι μοναδικό
    const free = match && !(await db.mydataIncoming.findFirst({ where: { purchaseDocId: match.id }, select: { id: true } }));
    const found = free && match ? { status: "MATCHED", purchaseDocId: match.id } : {};
    if (status === undefined) {
      await db.mydataIncoming.create({ data: { orgId, mark: d.mark, ...fields, ...found } });
      if (!free) added++;
    } else await db.mydataIncoming.update({ where: { orgId_mark: { orgId, mark: d.mark } }, data: { ...fields, ...found } });
  }
  // ακυρώθηκε στην ΑΑΔΕ (δεν επιστρέφεται πια): ό,τι δεν είχε αγγίξει κανείς φεύγει. Αν κάποιο κλειδί δεν απάντησε δεν σβήνουμε τίποτα:
  // η απουσία μπορεί να είναι μόνο δική του
  const removed = failed ? { count: 0 } : await db.mydataIncoming.deleteMany({ where: { orgId, status: "MISSING", issuedAt: { gte: from, lte: to }, mark: { notIn: docs.map((d) => d.mark) } } });
  const missing = await db.mydataIncoming.count({ where: { orgId, status: "MISSING" } });
  return { added, removed: removed.count, missing, failed };
}

/** Βραδινός γύρος για όλες τις επιχειρήσεις με κλειδιά· τα παλιά (OLD_DAYS) μπαίνουν μία φορά στις «Εργασίες». */
export async function syncAllIncoming(now = new Date()) {
  const orgs = await db.organization.findMany({ where: HAS_KEYS, select: { id: true } });
  let missing = 0, failed = 0;
  for (const { id: orgId } of orgs) {
    try { missing += (await syncIncoming(orgId, now)).missing; } catch (e) { failed++; console.error("mydata incoming", orgId, e); continue; }
    const old = await db.mydataIncoming.findMany({
      where: { orgId, status: "MISSING", notifiedAt: null, issuedAt: { lte: new Date(now.getTime() - OLD_DAYS * DAY) } },
      select: { id: true, supplierName: true, series: true, number: true, issuedAt: true, grossCents: true },
    });
    if (!old.length) continue;
    await runTask({ orgId, userId: "system", userName: "Βραδινός έλεγχος" }, { kind: "purchases.mydata-missing", title: `Λείπουν ${old.length} τιμολόγια προμηθευτών από τις αγορές`, permission: "purchases.read", total: old.length }, async (task) => {
      for (const o of old) await task.fail({ id: o.id, label: `${o.supplierName} · ${[o.series, o.number].filter(Boolean).join("-") || "χωρίς αριθμό"}`, reason: `Δηλώθηκε στο myDATA ${o.issuedAt?.toISOString().slice(0, 10) ?? ""} και δεν υπάρχει στις αγορές` });
      task.result("/purchases?view=missing");
    }).catch(() => undefined);
    await db.mydataIncoming.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { notifiedAt: now } });
  }
  return { orgs: orgs.length, missing, failed };
}

/** «Πέρασέ το»: πρόχειρο αγοράς από τα στοιχεία της ΑΑΔΕ, στην αποθήκη που διάλεξε ο χρήστης. */
export async function importIncoming(orgId: string, id: string, warehouseId: string, userName: string) {
  const row = await db.mydataIncoming.findFirst({ where: { id, orgId, status: "MISSING" } });
  if (!row) throw new MydataError("Το παραστατικό έχει ήδη περάσει ή δεν υπάρχει πια");
  const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, orgId, active: true }, select: { id: true } });
  if (!warehouse) throw new MydataError("Διάλεξε αποθήκη");
  // ήρθε ήδη με τη χειροκίνητη «Λήψη από myDATA»: δένεται, δεν διπλασιάζεται
  const existing = await db.purchaseDoc.findFirst({ where: { orgId, mydataMark: row.mark }, select: { id: true } });
  const raw = row.doc as unknown as MyIncomeDoc;
  const doc = existing ?? await createFromMydata(await importContext(orgId, userName, warehouse.id), { ...raw, issuedAt: raw.issuedAt ? new Date(raw.issuedAt) : null });
  await db.mydataIncoming.update({ where: { id }, data: { status: existing ? "MATCHED" : "IMPORTED", purchaseDocId: doc.id, resolvedByName: userName, resolvedAt: new Date() } });
  return doc.id;
}

/** «Το έχω σκαναρισμένο»: δένεται με παραστατικό που περάσαμε με άλλον αριθμό. */
export async function linkIncoming(orgId: string, id: string, purchaseDocId: string, userName: string) {
  const [row, doc] = await Promise.all([
    db.mydataIncoming.findFirst({ where: { id, orgId, status: "MISSING" }, select: { id: true } }),
    db.purchaseDoc.findFirst({ where: { id: purchaseDocId, orgId, mydataIncoming: null }, select: { id: true } }),
  ]);
  if (!row || !doc) throw new MydataError("Το παραστατικό δεν βρέθηκε ή έχει ήδη συνδεθεί");
  await db.mydataIncoming.update({ where: { id }, data: { status: "MATCHED", purchaseDocId: doc.id, resolvedByName: userName, resolvedAt: new Date() } });
}

/** «Δεν μας αφορά»: μένει σημειωμένο με τον λόγο και δεν ξαναεμφανίζεται. */
export async function ignoreIncoming(orgId: string, id: string, reason: string, userName: string) {
  const r = await db.mydataIncoming.updateMany({ where: { id, orgId, status: "MISSING" }, data: { status: "IGNORED", ignoredReason: reason, resolvedByName: userName, resolvedAt: new Date() } });
  if (!r.count) throw new MydataError("Το παραστατικό δεν βρέθηκε");
}

/** Η αποθήκη που παίρνει συνήθως ο προμηθευτής (από την τελευταία αγορά του), για προεπιλογή στο «Πέρασέ το». */
export async function usualWarehouses(orgId: string, vats: string[]) {
  if (!vats.length) return new Map<string, { id: string; name: string }>();
  const docs = await db.purchaseDoc.findMany({
    where: { orgId, supplier: { vatNumber: { in: vats } }, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 500,
    select: { supplier: { select: { vatNumber: true } }, warehouse: { select: { id: true, name: true } } },
  });
  const out = new Map<string, { id: string; name: string }>();
  for (const d of docs) if (d.supplier.vatNumber && !out.has(d.supplier.vatNumber)) out.set(d.supplier.vatNumber, d.warehouse);
  return out;
}
