// Παραλαβή από το κινητό του αποθηκάριου (εφαρμογή Android): ανάγνωση δελτίου αποστολής, ανοιχτές
// παραγγελίες με τα barcodes τους, και καταχώριση με την ίδια receivePurchaseOrder της web σελίδας.
import { setting } from "./config";
import { db } from "./db";
import { missingQty } from "./backorders";
import { receivedNote } from "./procurement-db";
import { supplierPhones } from "./supplier-phones";
import { canReceive, roleViews } from "./specialties";
import { spotKey, spotsFor } from "./storage-spots";
import { matchLine } from "./purchases";
import type { StockContext } from "./stock-scope";
import { openShift } from "./till-shift";
import { AiError, vision } from "./ai/openrouter";
import { chargeCents, parseInvoiceJson } from "./ai/ocr";

type Device = { org: { id: string }; store: { id: string }; device: { id: string; name: string } };

/**
 * Η συσκευή δρα για το κατάστημά της, με όνομα όποιον έχει τη βάρδια. Το scope αποθεμάτων ελέγχεται μέσω μελών
 * (membership), που η συσκευή δεν έχει· γι' αυτό το context είναι πλήρες και τον περιορισμό στις αποθήκες
 * του καταστήματος τον κάνει ρητά η παραλαβή (warehouseIds). Ο ρόλος της βάρδιας κρίνει αν επιτρέπεται.
 */
export async function deviceReceiving(ctx: Device, need: "receiving" | "stock" = "receiving") {
  const [shift, links] = await Promise.all([openShift(ctx.device.id), db.storeWarehouse.findMany({ where: { storeId: ctx.store.id }, select: { warehouseId: true } })]);
  const stock: StockContext = { orgId: ctx.org.id, membershipId: "", userId: "", userName: shift?.employee.name ?? ctx.device.name, permissions: [], storeIds: [], warehouseIds: [], can: () => true };
  const allowed = need === "receiving" ? canReceive(shift?.role) : roleViews(shift?.role).includes("stock");
  const denied = allowed ? null : need === "receiving" ? "Η παραλαβή γίνεται με ρόλο Αποθηκάριος ή Μάνατζερ. Άλλαξε ρόλο από τη βάρδια." : "Το απόθεμα το βλέπει ο ρόλος Αποθηκάριος, Chef ή Μάνατζερ.";
  return { stock, warehouseIds: links.map((l) => l.warehouseId), denied };
}

/** Η παραγγελία ανήκει σε αποθήκη του καταστήματος; Αλλιώς η συσκευή δεν την παραλαμβάνει. */
export async function orderInStore(orgId: string, orderId: string, warehouseIds: readonly string[]) {
  return !!(await db.purchaseOrder.findFirst({ where: { id: orderId, orgId, warehouseId: { in: [...warehouseIds] } }, select: { id: true } }));
}

export type ReceivingCode = { code: string; base: number }; // barcode → πόσες βασικές μονάδες είναι μία σάρωση

/** Ανοιχτές παραγγελίες (στάλθηκαν ή ήρθαν μερικώς) των αποθηκών του καταστήματος, με ό,τι χρειάζεται η σάρωση. */
export async function openOrders(ctx: StockContext, warehouseIds: readonly string[]) {
  const orders = await db.purchaseOrder.findMany({
    where: { orgId: ctx.orgId, status: { in: ["SENT", "PARTIAL"] }, warehouseId: { in: [...warehouseIds] } },
    include: { lines: true },
    orderBy: { createdAt: "asc" }, // πρώτα η παλιότερη: αυτή καλύπτεται πρώτη
    take: 100,
  });
  const warehouses = await db.warehouse.findMany({ where: { orgId: ctx.orgId, id: { in: [...warehouseIds] } }, select: { id: true, name: true } });
  const spots = await spotsFor(ctx.orgId, warehouseIds, [...new Set(orders.flatMap((o) => o.lines.map((l) => l.genericItemId)))]);
  const genericIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.genericItemId)))];
  const [suppliers, generics, mappings, supplierItems] = await Promise.all([
    db.party.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(orders.map((o) => o.supplierId))] } }, select: { id: true, name: true, vatNumber: true, phone: true, contactName: true,
      channels: { where: { kind: "phone" }, select: { value: true, label: true } },
      contacts: { where: { active: true }, orderBy: { isPrimary: "desc" }, select: { title: true, person: { select: { name: true, channels: { where: { kind: "phone" }, select: { value: true, label: true } } } } } } } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: genericIds } }, select: { id: true, name: true, baseUnit: { select: { dimension: true } } } }),
    db.itemMapping.findMany({ where: { orgId: ctx.orgId, genericItemId: { in: genericIds } }, include: { tradeItem: { select: { id: true, ean: true, contentQty: true } } } }),
    db.supplierItem.findMany({ where: { orgId: ctx.orgId, active: true, tradeItem: { mappings: { some: { orgId: ctx.orgId, genericItemId: { in: genericIds } } } } }, include: { tradeItem: { select: { contentQty: true, mappings: { where: { orgId: ctx.orgId }, select: { genericItemId: true } } } } } }),
  ]);
  const supplierOf = new Map(suppliers.map((s) => [s.id, { id: s.id, name: s.name, vatNumber: s.vatNumber, phones: supplierPhones(s) }]));
  const genericOf = new Map(generics.map((g) => [g.id, g]));

  return orders.map((o) => ({
    id: o.id, number: o.number, createdAt: o.createdAt,
    warehouse: warehouses.find((w) => w.id === o.warehouseId) ?? { id: o.warehouseId, name: "—" },
    spots: spots.byWarehouse.get(o.warehouseId) ?? [], // οι θέσεις της αποθήκης, για να οριστεί θέση σε νέο υλικό
    supplier: supplierOf.get(o.supplierId) ?? { id: o.supplierId, name: "—", vatNumber: null, phones: [] },
    lines: o.lines.filter((l) => missingQty(l) > 0).map((l) => {
      const ofSupplier = supplierItems.filter((s) => s.supplierId === o.supplierId && s.tradeItem.mappings.some((m) => m.genericItemId === l.genericItemId));
      const codes: ReceivingCode[] = [
        ...ofSupplier.filter((s) => s.barcode).map((s) => ({ code: s.barcode!, base: s.packQty * s.tradeItem.contentQty })),
        ...mappings.filter((m) => m.genericItemId === l.genericItemId && m.tradeItem.ean).map((m) => ({ code: m.tradeItem.ean!, base: m.tradeItem.contentQty })),
      ];
      // η «συσκευασία» που μετράει ο αποθηκάριος: της γραμμής, αλλιώς η πρώτη γνωστή, αλλιώς μία βασική μονάδα
      const own = ofSupplier.find((s) => s.id === l.supplierItemId);
      const packBase = own ? own.packQty * own.tradeItem.contentQty : codes[0]?.base ?? 1;
      const g = genericOf.get(l.genericItemId);
      return { id: l.id, genericItemId: l.genericItemId, name: g?.name ?? "—", dimension: g?.baseUnit.dimension ?? "count", missing: missingQty(l), ordered: l.orderedBaseQty, packBase, codes, expectedAt: l.expectedAt, spot: spots.of.get(spotKey(l.genericItemId, o.warehouseId)) ?? null };
    }),
  })).filter((o) => o.lines.length);
}

/**
 * Διαβάζει φωτογραφία δελτίου αποστολής με την υπηρεσία OCR (ίδια χρέωση με τα τιμολόγια).
 * Επιστρέφει αριθμό, ημερομηνία, MARK, προμηθευτή από ΑΦΜ και γραμμές με είδος και ποσότητα σε βασικές μονάδες.
 */
export async function readDeliveryNote(ctx: StockContext, mime: string, base64: string) {
  const price = await db.usagePrice.findUnique({ where: { service: "ocr" } });
  if (!price?.active) throw new AiError("Η ανάγνωση δελτίων δεν είναι ενεργή — ενεργοποιείται από την πλατφόρμα. Διάλεξε προμηθευτή με το χέρι.");
  const r = await vision(NOTE_SYSTEM, NOTE_PROMPT, `data:${mime};base64,${base64}`);
  const note = parseInvoiceJson(r.text);
  const charge = chargeCents(r.costUsd, Number(await setting("USD_EUR_RATE")) || 0.92, price.markupPercent);
  await db.usageEvent.create({ data: { orgId: ctx.orgId, service: "ocr", units: 1, costUsd: r.costUsd, chargeCents: charge, detail: { model: r.model, kind: "delivery-note", lines: note.lines.length, promptTokens: r.promptTokens, completionTokens: r.completionTokens }, createdByName: ctx.userName } });

  const supplier = note.vatNumber ? await db.party.findFirst({ where: { orgId: ctx.orgId, vatNumber: note.vatNumber, roles: { has: "supplier" } }, select: { id: true, name: true } }) : null;
  const [supplierItems, tradeItems, mappings] = await Promise.all([
    db.supplierItem.findMany({ where: { orgId: ctx.orgId, active: true } }),
    db.tradeItem.findMany({ where: { OR: [{ orgId: null }, { orgId: ctx.orgId }] }, select: { id: true, ean: true, name: true, contentQty: true } }),
    db.itemMapping.findMany({ where: { orgId: ctx.orgId } }),
  ]);
  const content = new Map(tradeItems.map((t) => [t.id, t.contentQty]));
  const lines = note.lines.map((l) => {
    const m = supplier ? matchLine(l, { supplierId: supplier.id, supplierItems, tradeItems, mappings }) : {};
    const si = supplierItems.find((s) => s.id === m.supplierItemId);
    const base = m.tradeItemId ? l.quantity * (si?.packQty ?? 1) * (content.get(m.tradeItemId) ?? 1) : null;
    return { description: l.description, quantity: l.quantity, genericItemId: m.genericItemId ?? null, base };
  });
  const already = supplier ? await receivedNote(db, ctx.orgId, supplier.id, note.number, note.mydataMark) : null;
  return { number: note.number, date: note.issuedAt, mark: note.mydataMark, vatNumber: note.vatNumber, supplier, lines, already: already && { orderNumber: already.orderNumber, at: already.at, by: already.by, message: already.message } };
}

const NOTE_SYSTEM = "Είσαι εξειδικευμένος αναγνώστης ελληνικών δελτίων αποστολής προμηθευτών. Εξάγεις τα στοιχεία σε αυστηρό JSON και τίποτα άλλο.";
const NOTE_PROMPT = `Διάβασε το δελτίο αποστολής της φωτογραφίας και επέστρεψε ΜΟΝΟ JSON αυτής της μορφής:
{"number": <αριθμός δελτίου ή null>, "issuedAt": <"YYYY-MM-DD" ή null>, "vatNumber": <ΑΦΜ εκδότη, 9 ψηφία, ή null>, "mydataMark": <ΜΑΡΚ αν τυπώνεται, αλλιώς null>,
 "lines": [{"description": <περιγραφή είδους όπως τυπώνεται>, "quantity": <ακέραιη ποσότητα στη μονάδα του δελτίου, π.χ. κιβώτια>,
 "unitPrice": <τιμή μονάδας αν τυπώνεται, αλλιώς 0>, "vatRate": 0, "supplierCode": <κωδικός είδους του προμηθευτή ή null>, "ean": <barcode/EAN αν τυπώνεται, αλλιώς null>}]}
Κανόνες: ο εκδότης είναι ο προμηθευτής, όχι ο παραλήπτης. Μην βάζεις γραμμές συνόλων ή μεταφορικών ως είδη. Μην εφευρίσκεις τιμές που δεν διαβάζονται.`;
