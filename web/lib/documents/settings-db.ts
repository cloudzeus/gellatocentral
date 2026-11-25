// Εκδότες (LegalEntity) και σειρές παραστατικών της επιχείρησης: εγγραφές από τις Ρυθμίσεις.
// Κλειδιά myDATA και έμπορος Viva δεν αλλάζουν από εδώ· τα ορίζει η πλατφόρμα.
import { validAfm } from "../afm.ts";
import { db } from "../db.ts";
import type { StockContext } from "../stock-scope.ts";
import { auditWorkflow, cleanText, WorkflowError } from "../workflow-db.ts";

const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });

// Οι ρυθμίσεις αφορούν όλη την επιχείρηση: χρήστης περιορισμένος σε καταστήματα δεν τις αλλάζει
function assertWholeOrg(ctx: StockContext) {
  if (ctx.storeIds.length || ctx.warehouseIds.length) throw new WorkflowError("Η αλλαγή απαιτεί πρόσβαση σε όλα τα καταστήματα");
}

export type LegalEntityInput = { id?: string; name: string; vatNumber: string; taxOffice: string; address: string; city: string; postalCode: string; phone: string; active: boolean };

export async function saveLegalEntity(ctx: StockContext, input: LegalEntityInput) {
  assertWholeOrg(ctx);
  const vatNumber = input.vatNumber.replace(/\D/g, "");
  if (!validAfm(vatNumber)) throw new WorkflowError("Ο ΑΦΜ δεν είναι έγκυρος: 9 ψηφία με σωστό ψηφίο ελέγχου");
  const data = {
    name: cleanText(input.name, "Επωνυμία", 180, true)!, vatNumber,
    taxOffice: cleanText(input.taxOffice, "ΔΟΥ", 100), address: cleanText(input.address, "Διεύθυνση", 200, true),
    city: cleanText(input.city, "Πόλη", 100, true), postalCode: cleanText(input.postalCode, "ΤΚ", 20, true), phone: cleanText(input.phone, "Τηλέφωνο", 40), active: input.active,
  };
  return db.$transaction(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { vatNumber: true } });
    if (org.vatNumber.replace(/\D/g, "") === vatNumber) throw new WorkflowError("Αυτός είναι ο ΑΦΜ της επιχείρησης· τα καταστήματά της εκδίδουν ήδη με αυτόν");
    const same = await tx.legalEntity.findFirst({ where: { orgId: ctx.orgId, vatNumber, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
    if (same) throw new WorkflowError("Υπάρχει ήδη εκδότης με αυτόν τον ΑΦΜ");
    if (input.id) {
      const current = await tx.legalEntity.findFirst({ where: { id: input.id, orgId: ctx.orgId }, include: { _count: { select: { stores: true } } } });
      if (!current) throw new WorkflowError("Ο εκδότης δεν βρέθηκε");
      // ΑΦΜ και ενεργότητα κλειδώνουν όσο κάποιο κατάστημα εκδίδει με αυτόν· αλλιώς τα ταμεία του θα σταματούσαν ή θα άλλαζαν ΑΦΜ χωρίς να το δει κανείς
      if (current._count.stores && current.vatNumber !== vatNumber) throw new WorkflowError("Ο ΑΦΜ δεν αλλάζει όσο καταστήματα εκδίδουν με αυτόν. Πρόσθεσε νέο εκδότη και μετάφερε τα καταστήματα");
      if (current._count.stores && !data.active) throw new WorkflowError("Μετάφερε πρώτα τα καταστήματά του σε άλλον εκδότη");
      const saved = await tx.legalEntity.update({ where: { id: current.id }, data });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "legal_entity.updated", entityType: "legal_entity", entityId: saved.id, metadata: { vatNumber } });
      return saved;
    }
    const saved = await tx.legalEntity.create({ data: { ...data, orgId: ctx.orgId } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "legal_entity.created", entityType: "legal_entity", entityId: saved.id, metadata: { vatNumber } });
    return saved;
  });
}

/** legalEntityId κενό = το κατάστημα εκδίδει με τον ΑΦΜ της επιχείρησης. */
export async function setStoreIssuer(ctx: StockContext, storeId: string, legalEntityId: string | null) {
  assertWholeOrg(ctx);
  return db.$transaction(async (tx) => {
    const store = await tx.store.findFirst({ where: { id: storeId, orgId: ctx.orgId }, select: { id: true, legalEntityId: true } });
    if (!store) throw new WorkflowError("Το κατάστημα δεν βρέθηκε");
    if (legalEntityId && !(await tx.legalEntity.findFirst({ where: { id: legalEntityId, orgId: ctx.orgId, active: true }, select: { id: true } })))
      throw new WorkflowError("Διάλεξε ενεργό εκδότη της επιχείρησης");
    if (await tx.sale.findFirst({ where: { orgId: ctx.orgId, storeId, status: "AWAITING_PAYMENT" }, select: { id: true } }))
      throw new WorkflowError("Υπάρχει πληρωμή σε εξέλιξη σε ταμείο του καταστήματος· δοκίμασε όταν ολοκληρωθεί");
    await tx.store.update({ where: { id: storeId }, data: { legalEntityId } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "store.issuer_changed", entityType: "store", entityId: storeId, storeId, metadata: { from: store.legalEntityId, to: legalEntityId } });
  });
}

export type SeriesInput = { id?: string; docType: string; code: string; name: string; storeId: string; nextAa: number; isDefault: boolean; active: boolean };

export async function saveSeries(ctx: StockContext, input: SeriesInput) {
  assertWholeOrg(ctx);
  const code = cleanText(input.code, "Γράμμα σειράς", 20, true)!;
  const name = cleanText(input.name, "Περιγραφή", 120);
  if (!Number.isSafeInteger(input.nextAa) || input.nextAa < 1 || input.nextAa > 999_999_999) throw new WorkflowError("Ο πρώτος αριθμός είναι θετικός ακέραιος");
  return db.$transaction(async (tx) => {
    const type = await tx.documentType.findFirst({ where: { code: input.docType, active: true, retail: false }, select: { code: true } });
    if (!type) throw new WorkflowError("Διάλεξε τύπο παραστατικού");
    const store = input.storeId ? await tx.store.findFirst({ where: { id: input.storeId, orgId: ctx.orgId }, select: { id: true } }) : null;
    if (input.storeId && !store) throw new WorkflowError("Το κατάστημα δεν βρέθηκε");
    const clash = await tx.documentSeries.findFirst({ where: { orgId: ctx.orgId, docType: type.code, code, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
    if (clash) throw new WorkflowError(`Υπάρχει ήδη σειρά «${code}» για ${type.code}. Διάλεξε άλλο γράμμα`);

    let id = input.id;
    if (id) {
      const current = await tx.documentSeries.findFirst({ where: { id, orgId: ctx.orgId }, include: { _count: { select: { documents: true } } } });
      if (!current) throw new WorkflowError("Η σειρά δεν βρέθηκε");
      const used = current._count.documents > 0;
      // σειρά με εκδόσεις: η αρίθμηση έχει φτάσει στην ΑΑΔΕ, άρα μένουν ίδια τύπος, γράμμα, κατάστημα και αριθμός
      if (used && (current.docType !== type.code || current.code !== code || current.storeId !== (store?.id ?? null) || current.nextAa !== input.nextAa))
        throw new WorkflowError("Η σειρά έχει εκδόσεις: αλλάζουν μόνο περιγραφή, προεπιλογή και αν είναι ενεργή");
      await tx.documentSeries.update({ where: { id }, data: { docType: type.code, code, name, storeId: store?.id ?? null, nextAa: input.nextAa, active: input.active, isDefault: input.isDefault && input.active } });
    } else {
      id = (await tx.documentSeries.create({ data: { orgId: ctx.orgId, docType: type.code, code, name, storeId: store?.id ?? null, nextAa: input.nextAa, active: input.active, isDefault: input.isDefault && input.active } })).id;
    }
    // μία προεπιλογή ανά τύπο και κατάστημα
    if (input.isDefault && input.active)
      await tx.documentSeries.updateMany({ where: { orgId: ctx.orgId, docType: type.code, storeId: store?.id ?? null, id: { not: id } }, data: { isDefault: false } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: input.id ? "series.updated" : "series.created", entityType: "document_series", entityId: id, storeId: store?.id ?? undefined, metadata: { docType: type.code, code } });
    return id;
  });
}
