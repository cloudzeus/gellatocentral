// Εξαγωγή όλων των δεδομένων μιας επιχείρησης και οριστική διαγραφή της. Χρησιμοποιούνται στο κλείσιμο επιχείρησης.
import { db } from "./db";
import { deleteFile } from "./storage";

/**
 * Ό,τι κρατάμε για την επιχείρηση, σε ένα αντικείμενο. Δεν περιέχει κωδικούς, κλειδιά συσκευών ή τα ίδια τα αρχεία
 * (μόνο τη λίστα τους· κατεβαίνουν από την εφαρμογή όσο είναι ανοιχτή).
 * shortcut: όλα σε ένα JSON στη μνήμη· για επιχείρηση με εκατοντάδες χιλιάδες αποδείξεις θέλει εξαγωγή σε ροή ή σε αρχεία ανά έτος.
 */
export async function exportOrg(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { subscription: { include: { charges: true, plan: { select: { name: true } } } } } });
  if (!org) return null;
  const where = { orgId };
  const [stores, warehouses, printers, devices, roles, members, categories, products, parties, sales, files, tickets, pauses, consents, erasures] = await Promise.all([
    db.store.findMany({ where }),
    db.warehouse.findMany({ where }),
    db.printer.findMany({ where }),
    db.device.findMany({ where, omit: { apiTokenHash: true, pairCode: true, pairCodeExpiresAt: true } }),
    db.orgRole.findMany({ where }),
    db.membership.findMany({ where, select: { storeId: true, role: { select: { name: true } }, user: { select: { name: true, email: true, createdAt: true, lastLoginAt: true, disabledAt: true } } } }),
    db.category.findMany({ where }),
    db.product.findMany({ where }),
    db.party.findMany({ where, include: { addresses: true, contacts: { include: { person: { include: { channels: true } } } }, channels: true, activities: true, bankAccounts: true } }),
    db.sale.findMany({ where, orderBy: { createdAt: "asc" }, include: { lines: true, payment: true, fiscal: true } }),
    db.storedFile.findMany({ where, select: { id: true, name: true, category: true, refType: true, refId: true, size: true, contentType: true, createdAt: true } }),
    db.ticket.findMany({ where, include: { messages: { where: { internal: false } } } }),
    db.storePause.findMany({ where }),
    db.consent.findMany({ where }),
    db.erasureRequest.findMany({ where }),
  ]);
  return { exportedAt: new Date(), organization: org, stores, warehouses, printers, devices, roles, users: members, categories, products, parties, sales, files, tickets, storePauses: pauses, consents, erasureRequests: erasures };
}

/**
 * Τι οφείλουμε πριν σβήσουμε επιχείρηση που εξέδιδε αποδείξεις μέσω Viva Fiscal (βλ. skill viva-fiscalisation):
 *  - Πάροχος ηλεκτρονικής τιμολόγησης είναι η Viva (εξουσιοδότηση του εμπόρου στο gov.gr, δήλωση Α.1112 άρθρο 6)· εκείνη
 *    υπογράφει, διαβιβάζει στο myDATA και φιλοξενεί την απόδειξη πίσω από το QR. Εμείς είμαστε το ταμείο (POS/ERP).
 *  - Δική μας δουλειά είναι να μη χαθεί απόδειξη που δεν έχει διαβιβαστεί: όσο υπάρχουν εκκρεμείς ή αποτυχημένες, δεν σβήνουμε.
 *  - Το αρχείο των στοιχείων το οφείλει ο εκδότης (ο έμπορος)· πριν φύγει του δίνουμε πλήρες αντίγραφο και αρχείο αποδείξεων.
 * Οι προθεσμίες φύλαξης του εμπόρου είναι θέμα του λογιστή του, όχι αυτού του κώδικα.
 */
export async function closingChecks(orgId: string) {
  const [stuck, exported, receipts, range] = await Promise.all([
    db.fiscalDocument.count({ where: { status: { in: ["PENDING", "FAILED"] }, sale: { orgId, status: "COMPLETED" } } }),
    db.accessEvent.findFirst({ where: { orgId, action: "org.exported" }, orderBy: { createdAt: "desc" } }),
    db.sale.count({ where: { orgId, status: "COMPLETED" } }),
    db.sale.aggregate({ where: { orgId, status: "COMPLETED" }, _min: { issuedAt: true }, _max: { issuedAt: true } }),
  ]);
  return { stuck, exportedAt: exported?.createdAt ?? null, exportedBy: exported?.actorName ?? null, receipts, first: range._min.issuedAt, last: range._max.issuedAt };
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const FISCAL_TEXT: Record<string, string> = { SIGNED: "Διαβιβάστηκε", PENDING: "Εκκρεμεί", FAILED: "Απέτυχε", NOT_SENT: "Δοκιμαστική (δεν διαβιβάστηκε)" };
/** Αρχείο αποδείξεων για τον λογιστή: μία γραμμή ανά απόδειξη, σε CSV που ανοίγει στο Excel (UTF-8 με BOM, διαχωριστικό «;»). */
export async function receiptsCsv(orgId: string) {
  const sales = await db.sale.findMany({ where: { orgId, status: "COMPLETED" }, orderBy: [{ issuedAt: "asc" }, { aa: "asc" }], include: { store: { select: { name: true } }, payment: { select: { method: true, vivaTransactionId: true } }, fiscal: { select: { docType: true, status: true, receiptReference: true } }, lines: { select: { quantity: true, unitPriceCents: true, vatRate: true } } } });
  const rows = sales.map((x) => [x.issuedAt?.toISOString() ?? "", x.fiscal?.docType ?? "", x.series ?? "", x.aa ?? "", x.store.name, (x.totalCents / 100).toFixed(2).replace(".", ","), (x.lines.reduce((n, l) => n + Math.round((l.quantity * l.unitPriceCents * l.vatRate) / (100 + l.vatRate)), 0) / 100).toFixed(2).replace(".", ","), x.payment?.method === "CARD" ? "Κάρτα" : "Μετρητά", x.payment?.vivaTransactionId ?? "", FISCAL_TEXT[x.fiscal?.status ?? ""] ?? "", x.fiscal?.receiptReference ?? ""]);
  const head = ["Ημερομηνία (UTC)", "Είδος παραστατικού", "Σειρά", "ΑΑ", "Κατάστημα", "Σύνολο €", "ΦΠΑ €", "Πληρωμή", "Συναλλαγή Viva", "Διαβίβαση", "Αναφορά απόδειξης"];
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csv).join(";")).join("\r\n");
}

/**
 * Οριστική διαγραφή: αρχεία στο Bunny, ό,τι έχει orgId χωρίς αυτόματη διαγραφή, οι λογαριασμοί των χρηστών της και η ίδια.
 * Αν ένα αρχείο δεν σβηστεί από το Bunny σταματά εδώ, πριν χαθεί από τη βάση το πού βρίσκεται.
 */
export async function deleteOrgForever(orgId: string) {
  if ((await closingChecks(orgId)).stuck) throw new Error("STUCK_RECEIPTS");
  const files = await db.storedFile.findMany({ where: { orgId }, select: { id: true, path: true } });
  for (const f of files) await deleteFile(f);
  const userIds = (await db.membership.findMany({ where: { orgId }, select: { userId: true } })).map((m) => m.userId);
  await db.$transaction(async (tx) => {
    const where = { orgId };
    await tx.consent.deleteMany({ where });
    await tx.erasureRequest.deleteMany({ where });
    await tx.gdprEvent.deleteMany({ where });
    await tx.kbChunk.deleteMany({ where });
    await tx.accessEvent.deleteMany({ where });
    await tx.organization.delete({ where: { id: orgId } }); // τα υπόλοιπα (καταστήματα, πωλήσεις, πελάτες, αιτήματα…) φεύγουν μαζί
    // λογαριασμοί που ανήκαν μόνο εδώ· το προσωπικό της πλατφόρμας δεν αγγίζεται
    await tx.user.deleteMany({ where: { id: { in: userIds }, platformRole: null, memberships: { none: {} } } });
  });
  return { files: files.length, users: userIds.length };
}
