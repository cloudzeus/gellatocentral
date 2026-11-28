// Κέντρα κόστους στη βάση: προεπιλογές, κέντρο ανά κατάστημα, κανόνες κατανομής και προεπισκόπηση κατανομής.
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { allocate, assertNoCycle, type Basis, BASES, checkShares, CostCenterError, DEFAULT_CENTERS, HQ_CODE, overlaps, type Share, STORES_CODE } from "./cost-centers-rules";
import type { StockContext } from "./stock-scope";
import { WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
const RULES_FROM = new Date("2026-01-01T00:00:00Z");
const lock = (tx: Tx, orgId: string) => tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`cost-centers:${orgId}`}, 0))) AS lock`;

/**
 * Φτιάχνει ό,τι λείπει, χωρίς να πειράζει ό,τι υπάρχει: τα προεπιλεγμένα κέντρα, έναν κανόνα για κάθε κοινό κέντρο
 * χωρίς κανόνα, και ένα κέντρο «10.n» για κάθε κατάστημα που δεν έχει. Ασφαλές να καλείται ξανά και ξανά.
 */
export async function ensureCostCenters(tx: Tx, orgId: string) {
  await lock(tx, orgId);
  const existing = await tx.costCenter.findMany({ where: { orgId }, select: { id: true, code: true, storeId: true, _count: { select: { rules: true } } } });
  const byCode = new Map(existing.map((c) => [c.code, c]));
  for (const d of DEFAULT_CENTERS) {
    if (byCode.has(d.code)) continue;
    const c = await tx.costCenter.create({ data: { orgId, code: d.code, name: d.name, kind: d.kind, source: "SEED" }, select: { id: true, code: true, storeId: true, _count: { select: { rules: true } } } });
    byCode.set(c.code, c);
    if (d.basis) await tx.costAllocationRule.create({ data: { orgId, sourceId: c.id, basis: d.basis, validFrom: RULES_FROM } });
  }
  const parentId = byCode.get(STORES_CODE)!.id;
  const covered = new Set(existing.map((c) => c.storeId).filter(Boolean));
  const stores = await tx.store.findMany({ where: { orgId, id: { notIn: [...covered] as string[] } }, select: { id: true, name: true }, orderBy: { id: "asc" } });
  let n = Math.max(0, ...existing.map((c) => /^10\.(\d+)$/.exec(c.code)?.[1]).filter(Boolean).map(Number));
  for (const s of stores) await tx.costCenter.create({ data: { orgId, code: `${STORES_CODE}.${++n}`, name: s.name, kind: "STORE", parentId, storeId: s.id, source: "SEED" } });
}

/** Το κέντρο που παίρνει μια δαπάνη χωρίς ρητή επιλογή: του καταστήματος, αλλιώς η έδρα. */
export async function defaultCostCenterId(tx: Tx, orgId: string, storeId: string | null) {
  await ensureCostCenters(tx, orgId);
  const c = await tx.costCenter.findFirst({ where: storeId ? { orgId, storeId } : { orgId, code: HQ_CODE }, select: { id: true } });
  return c!.id;
}

/** Ρητή επιλογή κέντρου σε δαπάνη: πρέπει να είναι ενεργό και της ίδιας επιχείρησης. */
export async function assertCostCenter(tx: Tx, orgId: string, id: string) {
  // WorkflowError: η φόρμα δαπάνης δείχνει το μήνυμα όπως τα υπόλοιπα λάθη της
  if (!await tx.costCenter.findFirst({ where: { id, orgId, active: true }, select: { id: true } })) throw new WorkflowError("Το κέντρο κόστους δεν βρέθηκε ή είναι ανενεργό");
}

export async function listCostCenters(orgId: string) {
  return db.$transaction(async (tx) => {
    await ensureCostCenters(tx, orgId);
    return tx.costCenter.findMany({ where: { orgId }, orderBy: { code: "asc" }, include: { rules: { orderBy: { validFrom: "desc" } }, _count: { select: { expenses: true } } } });
  });
}

const cleanCode = (code: string) => {
  const c = code.trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,24}$/.test(c)) throw new CostCenterError("Ο κωδικός θέλει γράμματα, αριθμούς, τελεία ή παύλα (έως 25)");
  return c;
};

export async function saveCostCenter(ctx: StockContext, input: { id?: string; code: string; name: string; kind: string; parentId: string | null; accountCode: string | null; source?: "USER" | "ACCOUNTANT" }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new CostCenterError("Δώσε όνομα στο κέντρο");
  if (!["STORE", "PRODUCTION", "HQ", "DELIVERY", "OTHER"].includes(input.kind)) throw new CostCenterError("Άγνωστο είδος κέντρου");
  return db.$transaction(async (tx) => {
    await ensureCostCenters(tx, ctx.orgId);
    const all = await tx.costCenter.findMany({ where: { orgId: ctx.orgId }, select: { id: true, parentId: true, code: true } });
    if (input.parentId && !all.some((c) => c.id === input.parentId)) throw new CostCenterError("Το γονικό κέντρο δεν βρέθηκε");
    if (input.id && !all.some((c) => c.id === input.id)) throw new CostCenterError("Το κέντρο δεν βρέθηκε");
    if (input.id) assertNoCycle(input.id, input.parentId, new Map(all.map((c) => [c.id, c.parentId])));
    const code = cleanCode(input.code);
    if (all.some((c) => c.code === code && c.id !== input.id)) throw new CostCenterError(`Ο κωδικός ${code} υπάρχει ήδη`);
    const data = { code, name, kind: input.kind, parentId: input.parentId, accountCode: input.accountCode?.trim() || null };
    return input.id
      ? tx.costCenter.update({ where: { id: input.id }, data })
      : tx.costCenter.create({ data: { ...data, orgId: ctx.orgId, source: input.source ?? "USER", createdByName: ctx.userName } });
  });
}

/** Κέντρο με κινήσεις δεν σβήνεται· μόνο απενεργοποιείται. Το κέντρο καταστήματος ακολουθεί το κατάστημα. */
export async function setCostCenterActive(ctx: StockContext, id: string, active: boolean) {
  const c = await db.costCenter.findFirst({ where: { id, orgId: ctx.orgId }, select: { code: true } });
  if (!c) throw new CostCenterError("Το κέντρο δεν βρέθηκε");
  if (!active && DEFAULT_CENTERS.some((d) => d.code === c.code && (d.code === STORES_CODE || d.code === HQ_CODE))) throw new CostCenterError("Τα «Καταστήματα» και η «Διοίκηση» χρειάζονται πάντα: δέχονται τις δαπάνες χωρίς άλλο κέντρο");
  await db.costCenter.update({ where: { id }, data: { active } });
}

/** `closeOpen`: ο νέος κανόνας αντικαθιστά όποιον ξεκινά την ίδια μέρα και κλείνει τον ανοιχτό που ξεκίνησε πριν. */
export type RuleInput = { id?: string; sourceId: string; basis: Basis; validFrom: Date; validTo: Date | null; shares: Share[]; closeOpen?: boolean };
const DAY = 86_400_000;

export async function saveAllocationRule(ctx: StockContext, input: RuleInput) {
  if (!BASES.includes(input.basis)) throw new CostCenterError("Άγνωστη βάση κατανομής");
  checkShares(input.basis, input.shares);
  return db.$transaction(async (tx) => {
    await lock(tx, ctx.orgId);
    const source = await tx.costCenter.findFirst({ where: { id: input.sourceId, orgId: ctx.orgId }, select: { kind: true, storeId: true } });
    if (!source) throw new CostCenterError("Το κέντρο δεν βρέθηκε");
    if (source.storeId) throw new CostCenterError("Το κέντρο καταστήματος είναι τελικό: δεν μοιράζεται αλλού");
    if (input.shares.length) {
      const ok = await tx.costCenter.count({ where: { orgId: ctx.orgId, id: { in: input.shares.map((s) => s.costCenterId) }, storeId: { not: null } } });
      if (ok !== input.shares.length) throw new CostCenterError("Τα μερίδια πάνε μόνο σε κέντρα καταστημάτων της επιχείρησης");
    }
    let id = input.id;
    let others = await tx.costAllocationRule.findMany({ where: { orgId: ctx.orgId, sourceId: input.sourceId, ...(id ? { id: { not: id } } : {}) }, select: { id: true, validFrom: true, validTo: true } });
    if (input.closeOpen && !id) {
      const same = others.find((o) => o.validFrom.getTime() === input.validFrom.getTime());
      if (same) { id = same.id; others = others.filter((o) => o !== same); }
      const open = others.find((o) => !o.validTo && o.validFrom < input.validFrom);
      if (open) {
        open.validTo = new Date(input.validFrom.getTime() - DAY);
        await tx.costAllocationRule.update({ where: { id: open.id }, data: { validTo: open.validTo } });
      }
    }
    if (others.some((o) => overlaps(input, o))) throw new CostCenterError("Υπάρχει ήδη κανόνας για αυτό το κέντρο στην ίδια περίοδο· βάλε λήξη στον παλιό");
    const data = { basis: input.basis, validFrom: input.validFrom, validTo: input.validTo, shares: input.shares, createdByName: ctx.userName };
    if (id) {
      const { count } = await tx.costAllocationRule.updateMany({ where: { id, orgId: ctx.orgId, sourceId: input.sourceId }, data });
      if (!count) throw new CostCenterError("Ο κανόνας δεν βρέθηκε");
      return id;
    }
    return (await tx.costAllocationRule.create({ data: { ...data, orgId: ctx.orgId, sourceId: input.sourceId } })).id;
  });
}

/**
 * «Πώς μοιράζεται ένα ποσό»: ο κανόνας που ισχύει στην αρχή της περιόδου, με τζίρο (ολοκληρωμένες πωλήσεις) ή
 * παραγγελίες delivery (παραδομένες) της περιόδου [from, to). Επιστρέφει ποσά ανά κέντρο καταστήματος.
 */
export async function previewAllocation(orgId: string, sourceId: string, amountCents: number, from: Date, to: Date) {
  const rule = await db.costAllocationRule.findFirst({
    where: { orgId, sourceId, validFrom: { lte: from }, OR: [{ validTo: null }, { validTo: { gte: from } }] },
    orderBy: { validFrom: "desc" },
  });
  if (!rule) throw new CostCenterError("Το κέντρο δεν έχει κανόνα κατανομής για την περίοδο");
  const stores = await db.costCenter.findMany({ where: { orgId, active: true, storeId: { not: null } }, select: { id: true, storeId: true }, orderBy: { code: "asc" } });
  const centerOf = new Map(stores.map((c) => [c.storeId!, c.id]));
  const measure = new Map<string, number>();
  if (rule.basis === "REVENUE") {
    const rows = await db.sale.groupBy({ by: ["storeId"], where: { orgId, status: "COMPLETED", issuedAt: { gte: from, lt: to } }, _sum: { totalCents: true } });
    for (const r of rows) if (centerOf.has(r.storeId)) measure.set(centerOf.get(r.storeId)!, r._sum.totalCents ?? 0);
  } else if (rule.basis === "ORDERS") {
    const rows = await db.order.groupBy({ by: ["storeId"], where: { orgId, delivery: true, status: "DELIVERED", createdAt: { gte: from, lt: to } }, _count: true });
    for (const r of rows) if (centerOf.has(r.storeId)) measure.set(centerOf.get(r.storeId)!, r._count);
  }
  const result = allocate(amountCents, rule.basis as Basis, rule.shares as Share[], stores.map((s) => s.id), measure);
  // τα σταθερά μερίδια μπορεί να δείχνουν και σε ανενεργό κατάστημα: τα ονόματα από όλα τα κέντρα του αποτελέσματος
  const named = await db.costCenter.findMany({ where: { orgId, id: { in: [...result.cents.keys()] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  return { basis: rule.basis as Basis, warning: result.warning, rows: named.map((c) => ({ ...c, cents: result.cents.get(c.id)!, measure: measure.get(c.id) ?? null })) };
}
